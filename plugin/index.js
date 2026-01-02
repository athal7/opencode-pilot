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
} from './service-client.js'

// Load configuration from opencode.json and environment
const config = loadConfig()

export const Notify = async ({ $, client, directory }) => {
  if (!config.topic) {
    console.log('[opencode-ntfy] No topic configured, plugin disabled')
    return {}
  }

  console.log(`[opencode-ntfy] Initialized for topic: ${config.topic}`)
  
  // Session ID for this plugin instance
  const sessionId = randomUUID()
  
  // Interactive mode state
  let serviceConnected = false
  
  if (config.callbackHost) {
    console.log(`[opencode-ntfy] Interactive mode enabled (callback: ${config.callbackHost}:${config.callbackPort})`)
    
    // Set up permission response handler
    setPermissionHandler(async (permissionId, response) => {
      console.log(`[opencode-ntfy] Permission response received: ${permissionId} -> ${response}`)
      
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
          console.warn(`[opencode-ntfy] Unknown response type: ${response}`)
          return
      }
      
      // Submit permission response to OpenCode
      try {
        await client.permission.respond({
          id: permissionId,
          action,
        })
        console.log(`[opencode-ntfy] Permission ${permissionId} resolved with action: ${action}`)
      } catch (error) {
        console.warn(`[opencode-ntfy] Failed to respond to permission ${permissionId}: ${error.message}`)
      }
    })
    
    // Connect to service
    serviceConnected = await connectToService({ sessionId })
    if (serviceConnected) {
      console.log('[opencode-ntfy] Connected to callback service')
    } else {
      console.log('[opencode-ntfy] Callback service not running, interactive permissions disabled')
      console.log('[opencode-ntfy] Start service with: launchctl load ~/Library/LaunchAgents/io.opencode.ntfy.plist')
    }
  } else {
    console.log('[opencode-ntfy] Read-only mode (set callbackHost for interactive permissions)')
  }

  // Use directory from OpenCode (the actual repo), not process.cwd() (may be temp devcontainer dir)
  const repoName = basename(directory) || 'unknown'
  let idleTimer = null
  let retryCount = 0
  let lastErrorTime = 0

  return {
    event: async ({ event }) => {
      // Debug logging for event discovery (when NTFY_DEBUG is set)
      if (process.env.NTFY_DEBUG) {
        console.log(`[opencode-ntfy] Event: ${event.type}`, JSON.stringify(event.properties))
      }

      // Handle session status events (idle, busy, retry notifications)
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        
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
            console.log(`[opencode-ntfy] Retry notification sent (#${retryCount})`)
          } else {
            console.log(`[opencode-ntfy] Retry #${retryCount} suppressed (notifyFirst=${config.retryNotifyFirst}, notifyAfter=${config.retryNotifyAfter})`)
          }
          return
        }
        
        // Reset retry counter on any non-retry status
        if (retryCount > 0) {
          console.log(`[opencode-ntfy] Retry counter reset (was ${retryCount})`)
          retryCount = 0
        }
        
        // Handle idle status
        if (status === 'idle' && !idleTimer) {
          idleTimer = setTimeout(async () => {
            // Clear timer reference immediately to prevent race conditions
            idleTimer = null
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: `Idle (${repoName})`,
              message: 'Session waiting for input',
              authToken: config.authToken,
            })
          }, config.idleDelayMs)
        } else if (status === 'busy' && idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
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
          console.log(`[opencode-ntfy] Error notification sent: ${errorMessage}`)
        } else {
          console.log(`[opencode-ntfy] Error debounced (${Math.round(timeSinceLastError / 1000)}s since last, window=${config.errorDebounceMs / 1000}s)`)
        }
      }
      
      // Handle permission.updated events (interactive permissions)
      if (event.type === 'permission.updated') {
        const permission = event.properties?.permission
        if (!permission || permission.status !== 'pending' || !permission.id) {
          return
        }
        
        // Only send interactive notifications if service is connected
        if (!config.callbackHost || !isConnected()) {
          return
        }
        
        const permissionId = permission.id
        const tool = permission.tool || 'Unknown tool'
        // Use pattern (the actual command) if available, fall back to description
        const patterns = permission.pattern || permission.patterns
        const command = Array.isArray(patterns) ? patterns.join(' ') : (patterns || permission.description || 'Permission requested')
        
        try {
          // Request nonce from service
          const nonce = await requestNonce(permissionId)
          
          // Build callback URL
          const callbackUrl = `http://${config.callbackHost}:${config.callbackPort}/callback`
          
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
          
          console.log(`[opencode-ntfy] Permission notification sent for: ${tool}`)
        } catch (error) {
          console.warn(`[opencode-ntfy] Failed to send permission notification: ${error.message}`)
        }
      }
    },
    
    // Cleanup on shutdown
    shutdown: async () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      
      // Use isConnected() as the source of truth (socket may have closed unexpectedly)
      if (isConnected()) {
        await disconnectFromService()
      }
    },
  }
}

export default Notify
