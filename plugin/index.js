// opencode-ntfy - ntfy notification plugin for OpenCode
//
// This plugin sends notifications via ntfy.sh when:
// - Permission requests need approval (interactive, requires callbackHost)
// - Session goes idle after delay
// - Errors or retries occur
//
// Configuration via ~/.config/opencode-ntfy/config.json or environment variables.
// See README.md for full configuration options.

import { basename } from 'path'
import { randomUUID } from 'crypto'
import { sendNotification, sendPermissionNotification } from './notifier.js'
import { loadConfig } from './config.js'
import {
  connectToService,
  disconnectFromService,
  isConnected,
  requestNonce,
  setPermissionHandler,
  tryReconnect,
} from './service-client.js'

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

const Notify = async ({ $, client, directory, serverUrl }) => {
  if (!config.topic) {
    return {}
  }
  
  // Session ID for this plugin instance
  const sessionId = randomUUID()
  
  // Interactive mode state
  let serviceConnected = false
  
  if (config.callbackHost) {
    // Set up permission response handler
    setPermissionHandler(async (permissionId, response) => {
      // Map response to OpenCode permission action
      let action
      switch (response) {
        case 'once':
          action = 'allow'
          break
        case 'always':
          action = 'allowAlways'
          break
        case 'reject':
          action = 'deny'
          break
        default:
          return
      }
      
      // Submit permission response to OpenCode
      try {
        await client.permission.respond({
          id: permissionId,
          action,
        })
      } catch (error) {
        // Silently ignore - errors here shouldn't affect the user
      }
    })
    
    // Connect to service
    serviceConnected = await connectToService({ sessionId })
  }

  // Use directory from OpenCode (the actual repo), not process.cwd() (may be temp devcontainer dir)
  // For devcontainer clones, show both repo and branch name
  const repoName = parseRepoInfo(directory)
  
  // Per-conversation state tracking (Issue #34)
  // Each conversation has its own idle timer, cancel state, etc.
  // Key: conversationId (OpenCode session ID)
  const conversations = new Map()
  
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

  return {
    event: async ({ event }) => {
      // Handle session status events (idle, busy, retry notifications)
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        // Extract conversation ID from event for per-conversation tracking (Issue #34)
        const conversationId = event.properties?.info?.id
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
            
            // Build "Open Session" action if serverUrl and callbackHost are available
            // URL points to the mobile-friendly UI served by the callback service
            // The mobile UI proxies requests to OpenCode's API
            let actions
            if (serverUrl && config.callbackHost && capturedSessionId) {
              try {
                const opencodeUrl = new URL(serverUrl)
                const opencodePort = opencodeUrl.port || (opencodeUrl.protocol === 'https:' ? 443 : 80)
                // Mobile URL format: /m/{opencodePort}/{repoName}/session/{sessionId}
                // Use HTTPS (via Tailscale Serve) when callbackHttps is enabled
                const protocol = config.callbackHttps ? 'https' : 'http'
                const portSuffix = config.callbackHttps ? '' : `:${config.callbackPort}`
                const mobileUrl = `${protocol}://${config.callbackHost}${portSuffix}/m/${opencodePort}/${repoName}/session/${capturedSessionId}`
                actions = [{
                  action: 'view',
                  label: 'Open Session',
                  url: mobileUrl,
                  clear: true,
                }]
              } catch {
                // Silently ignore URL parsing errors
              }
            }
            
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: `Idle (${repoName})`,
              message: 'Session waiting for input',
              authToken: config.authToken,
              actions,
            })
          }, config.idleDelayMs)
        } else if (status === 'busy' && conv.idleTimer) {
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
          
          // Build "Open Session" action if serverUrl and callbackHost are available
          // Extract session ID from event properties
          const errorSessionId = event.properties?.info?.id || event.properties?.sessionId
          let actions
          if (serverUrl && config.callbackHost && errorSessionId) {
            try {
              const opencodeUrl = new URL(serverUrl)
              const opencodePort = opencodeUrl.port || (opencodeUrl.protocol === 'https:' ? 443 : 80)
              const protocol = config.callbackHttps ? 'https' : 'http'
              const portSuffix = config.callbackHttps ? '' : `:${config.callbackPort}`
              const mobileUrl = `${protocol}://${config.callbackHost}${portSuffix}/m/${opencodePort}/${repoName}/session/${errorSessionId}`
              actions = [{
                action: 'view',
                label: 'Open Session',
                url: mobileUrl,
                clear: true,
              }]
            } catch {
              // Silently ignore URL parsing errors
            }
          }
          
          await sendNotification({
            server: config.server,
            topic: config.topic,
            title: `Error (${repoName})`,
            message: errorMessage,
            priority: 5,
            tags: ['warning'],
            authToken: config.authToken,
            actions,
          })
        }
      }
      
      // Handle permission.updated events (interactive permissions)
      if (event.type === 'permission.updated') {
        const permission = event.properties?.permission
        if (!permission || permission.status !== 'pending' || !permission.id) {
          return
        }
        
        // Only send interactive notifications if callbackHost is configured
        if (!config.callbackHost) {
          return
        }
        
        // Try to reconnect if not connected (Issue #41: reconnect on permission request)
        if (!isConnected()) {
          const reconnected = await tryReconnect()
          if (!reconnected) {
            return
          }
        }
        
        const permissionId = permission.id
        const tool = permission.tool || 'Unknown tool'
        // Use pattern (the actual command) if available, fall back to description
        const patterns = permission.pattern || permission.patterns
        const command = Array.isArray(patterns) ? patterns.join(' ') : (patterns || permission.description || 'Permission requested')
        
        try {
          // Request nonce from service
          const nonce = await requestNonce(permissionId)
          
          // Build callback URL (use HTTPS via Tailscale Serve when configured)
          const protocol = config.callbackHttps ? 'https' : 'http'
          const portSuffix = config.callbackHttps ? '' : `:${config.callbackPort}`
          const callbackUrl = `${protocol}://${config.callbackHost}${portSuffix}/callback`
          
          // Send permission notification with action buttons
          await sendPermissionNotification({
            server: config.server,
            topic: config.topic,
            callbackUrl,
            nonce,
            tool,
            command,
            repoName,
            authToken: config.authToken,
          })
        } catch (error) {
          // Silently ignore - errors here shouldn't affect the user
        }
      }
    },
    
    // Cleanup on shutdown
    shutdown: async () => {
      // Clear all conversation idle timers
      for (const [conversationId, conv] of conversations) {
        if (conv.idleTimer) {
          clearTimeout(conv.idleTimer)
          conv.idleTimer = null
        }
      }
      conversations.clear()
      
      // Use isConnected() as the source of truth (socket may have closed unexpectedly)
      if (isConnected()) {
        await disconnectFromService()
      }
    },
  }
}

export default Notify
