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

// Load configuration from config file and environment
const config = loadConfig()

export const Notify = async ({ $, client, directory, serverUrl }) => {
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
  const repoName = basename(directory) || 'unknown'
  let idleTimer = null
  let retryCount = 0
  let lastErrorTime = 0
  let wasCanceled = false
  let currentSessionId = null

  return {
    event: async ({ event }) => {
      // Skip all notifications if session was canceled (except checking for canceled status itself)
      if (wasCanceled && event.type !== 'session.status') {
        return
      }
      
      // Track session ID from session.created and session.updated events
      if (event.type === 'session.created' || event.type === 'session.updated') {
        const eventSessionId = event.properties?.info?.id
        if (eventSessionId) {
          currentSessionId = eventSessionId
        }
      }

      // Handle session status events (idle, busy, retry notifications)
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        
        // Handle canceled status - suppress all future notifications
        if (status === 'canceled') {
          wasCanceled = true
          if (idleTimer) {
            clearTimeout(idleTimer)
            idleTimer = null
          }
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
        
        // Handle idle status
        if (status === 'idle' && !idleTimer) {
          idleTimer = setTimeout(async () => {
            // Clear timer reference immediately to prevent race conditions
            idleTimer = null
            // Don't send notification if session was canceled
            if (wasCanceled) {
              return
            }
            
            // Build "Open Session" action if serverUrl and callbackHost are available
            // URL format matches OpenCode web UI: {origin}/{directory}/session/{sessionId}
            let actions
            if (serverUrl && config.callbackHost && currentSessionId) {
              try {
                const url = new URL(serverUrl)
                url.hostname = config.callbackHost
                const sessionUrl = `${url.origin}/${repoName}/session/${currentSessionId}`
                actions = [{
                  action: 'view',
                  label: 'Open Session',
                  url: sessionUrl,
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
        } catch (error) {
          // Silently ignore - errors here shouldn't affect the user
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
