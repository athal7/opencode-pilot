// opencode-ntfy - ntfy notification plugin for OpenCode
//
// This plugin sends notifications via ntfy.sh when:
// - Permission requests need approval (interactive, requires callbackHost)
// - Session goes idle after delay
// - Errors or retries occur
//
// Configuration via opencode.json "ntfy" key or environment variables.
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

  return {
    event: async ({ event }) => {
      // Handle session status events (idle notifications)
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
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
      
      // TODO: Issue #7 - Handle error and retry events
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
