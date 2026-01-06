// opencode-pilot - ntfy notification plugin for OpenCode
//
// This plugin sends notifications via ntfy.sh when:
// - Session goes idle after delay
// - Errors or retries occur
//
// Configuration via ~/.config/opencode-pilot/config.yaml
// See README.md for full configuration options.

import { basename } from 'path'
import { sendNotification } from './notifier.js'
import { loadConfig } from './config.js'
import { initLogger, debug } from './logger.js'

/**
 * Parse directory path to extract repo name (and branch if in devcontainer clone)
 * 
 * Devcontainer clone paths follow the pattern:
 *   /path/.cache/devcontainer-clones/{repo}/{branch}
 * 
 * For these paths, returns "{repo}/{branch}" to show both in notifications.
 * For regular paths, returns just the basename.
 * 
 * @param {string} directory - Directory path from OpenCode
 * @returns {string} Repo name (with branch suffix for devcontainer clones)
 */
function parseRepoInfo(directory) {
  if (!directory) {
    return 'unknown'
  }
  
  // Check for devcontainer-clones path pattern
  const devcontainerMatch = directory.match(/devcontainer-clones\/([^/]+)\/([^/]+)$/)
  if (devcontainerMatch) {
    const [, repo, branch] = devcontainerMatch
    return `${repo}/${branch}`
  }
  
  // Fall back to basename for regular directories
  return basename(directory) || 'unknown'
}

// Load configuration from config file and environment
const config = loadConfig()

// Initialize debug logger (writes to file when enabled, no-op when disabled)
initLogger({ debug: config.debug, debugPath: config.debugPath })

const Notify = async ({ client, directory }) => {
  if (!config.topic) {
    debug('Plugin disabled: no topic configured')
    return {}
  }
  
  // Use directory from OpenCode (the actual repo), not process.cwd() (may be temp devcontainer dir)
  // For devcontainer clones, show both repo and branch name
  const repoName = parseRepoInfo(directory)
  
  debug(`Plugin initialized: topic=${config.topic}, repo=${repoName}`)
  
  // Per-conversation state tracking (Issue #34)
  // Each conversation has its own idle timer, cancel state, etc.
  // Key: conversationId (OpenCode session ID)
  const conversations = new Map()
  
  // Session ownership verification (Issue #50)
  // Prevents duplicate notifications when multiple OpenCode instances are running.
  // Events may be broadcast to all plugin instances, so we verify each session
  // belongs to our OpenCode instance before processing.
  const verifiedSessions = new Set()   // Sessions confirmed to be ours
  const rejectedSessions = new Set()   // Sessions confirmed to be foreign
  
  // Global state (shared across all conversations in this plugin instance)
  let retryCount = 0
  let lastErrorTime = 0

  // Helper to get or create conversation state (Issue #34)
  const getConversation = (id) => {
    if (!id) return null
    if (!conversations.has(id)) {
      conversations.set(id, { idleTimer: null, wasCanceled: false })
    }
    return conversations.get(id)
  }
  
  // Verify session ownership by checking if it exists in our OpenCode instance (Issue #50)
  // Returns true if session belongs to us, false if it's foreign
  const verifySessionOwnership = async (sessionId) => {
    if (!sessionId) return false
    
    // Already verified as ours
    if (verifiedSessions.has(sessionId)) return true
    
    // Already rejected as foreign
    if (rejectedSessions.has(sessionId)) return false
    
    // Query our OpenCode instance to check if session exists
    try {
      const result = await client.session.get({ id: sessionId })
      if (result.data) {
        verifiedSessions.add(sessionId)
        return true
      }
      // Session doesn't exist in our instance - it's foreign
      rejectedSessions.add(sessionId)
      return false
    } catch {
      // Error (likely 404) means session doesn't exist in our instance
      rejectedSessions.add(sessionId)
      return false
    }
  }

  return {
    event: async ({ event }) => {
      debug(`Event: ${event.type}`)
      
      // Handle session status events (idle, busy, retry notifications)
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        // Extract conversation ID from event for per-conversation tracking (Issue #34)
        // OpenCode uses sessionID (capital ID)
        const conversationId = event.properties?.sessionID || event.properties?.info?.id
        debug(`Event: session.status, status=${status}, sessionId=${conversationId || 'unknown'}`)
        
        // Verify session belongs to our OpenCode instance (Issue #50)
        // Skip events for sessions from other OpenCode instances to prevent duplicates
        const isOurs = await verifySessionOwnership(conversationId)
        if (!isOurs) return
        
        const conv = getConversation(conversationId)
        
        // Skip if no conversation ID or already canceled
        if (!conv) return
        if (conv.wasCanceled && status !== 'canceled') return
        
        // Handle canceled status - suppress all future notifications for this conversation
        if (status === 'canceled') {
          conv.wasCanceled = true
          if (conv.idleTimer) {
            clearTimeout(conv.idleTimer)
            conv.idleTimer = null
          }
          // Clean up conversation state
          conversations.delete(conversationId)
          return
        }
        
        // Handle retry status
        if (status === 'retry') {
          retryCount++
          
          // Check if we should notify based on config
          const shouldNotifyFirst = config.retryNotifyFirst && retryCount === 1
          const shouldNotifyAfterN = config.retryNotifyAfter > 0 && retryCount === config.retryNotifyAfter
          
          if (shouldNotifyFirst || shouldNotifyAfterN) {
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: `Retry (${repoName})`,
              message: `Retry attempt #${retryCount}`,
              priority: 4,
              tags: ['repeat'],
              authToken: config.authToken,
            })
          }
          return
        }
        
        // Reset retry counter on any non-retry status
        if (retryCount > 0) {
          retryCount = 0
        }
        
        // Handle idle status - set timer for THIS conversation
        if (status === 'idle' && !conv.idleTimer) {
          debug(`Idle timer starting: ${config.idleDelayMs}ms for session ${conversationId}`)
          // Capture conversation ID in closure so notification goes to correct conversation
          const capturedSessionId = conversationId
          
          conv.idleTimer = setTimeout(async () => {
            // Clear timer reference immediately to prevent race conditions
            const currentConv = conversations.get(capturedSessionId)
            if (currentConv) {
              currentConv.idleTimer = null
            }
            
            // Don't send notification if conversation was canceled
            if (currentConv?.wasCanceled) {
              return
            }
            
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: `Idle (${repoName})`,
              message: 'Session waiting for input',
              authToken: config.authToken,
            })
          }, config.idleDelayMs)
        } else if (status === 'busy' && conv.idleTimer) {
          debug(`Idle timer cancelled: session ${conversationId} now busy`)
          clearTimeout(conv.idleTimer)
          conv.idleTimer = null
        }
      }
      
      // Handle session.error events (debounced error notifications)
      if (event.type === 'session.error') {
        if (!config.errorNotify) {
          return
        }
        
        const now = Date.now()
        const timeSinceLastError = now - lastErrorTime
        
        if (lastErrorTime === 0 || timeSinceLastError >= config.errorDebounceMs) {
          lastErrorTime = now
          
          // Extract error message with fallback chain
          const errorMessage = 
            event.properties?.error?.message ||
            event.properties?.message ||
            event.properties?.error?.code ||
            event.properties?.error?.type ||
            'Unknown error'
          
          await sendNotification({
            server: config.server,
            topic: config.topic,
            title: `Error (${repoName})`,
            message: errorMessage,
            priority: 5,
            tags: ['warning'],
            authToken: config.authToken,
          })
        }
      }
    },
    
    // Cleanup on shutdown
    shutdown: async () => {
      // Clear all conversation idle timers
      for (const [, conv] of conversations) {
        if (conv.idleTimer) {
          clearTimeout(conv.idleTimer)
          conv.idleTimer = null
        }
      }
      conversations.clear()
      
      // Clear session ownership caches (Issue #50)
      verifiedSessions.clear()
      rejectedSessions.clear()
    },
  }
}

export default Notify
