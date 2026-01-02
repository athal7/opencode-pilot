// Service client for plugin-to-service IPC
// Implements Issue #13: Separate callback server as brew service
//
// This module connects to the standalone callback service via Unix socket
// and handles:
// - Session registration
// - Nonce requests for permission notifications
// - Permission response callbacks

import { createConnection } from 'net'

// Default socket path (same as service)
const DEFAULT_SOCKET_PATH = '/tmp/opencode-ntfy.sock'

// Connection state
let socket = null
let sessionId = null
let permissionHandler = null
let pendingNonceRequests = new Map() // permissionId -> resolve/reject

/**
 * Check if connected to the service
 * @returns {boolean} True if connected
 */
export function isConnected() {
  return socket !== null && !socket.destroyed
}

/**
 * Set the handler for permission responses
 * @param {Function} handler - Called with (permissionId, response) when permission response received
 */
export function setPermissionHandler(handler) {
  permissionHandler = handler
}

/**
 * Connect to the callback service
 * @param {Object} options
 * @param {string} options.sessionId - OpenCode session ID
 * @param {string} [options.socketPath] - Unix socket path (default: /tmp/opencode-ntfy.sock)
 * @returns {Promise<boolean>} True if connected successfully
 */
export async function connectToService(options) {
  const socketPath = options.socketPath || DEFAULT_SOCKET_PATH
  sessionId = options.sessionId
  
  return new Promise((resolve) => {
    socket = createConnection(socketPath)
    
    let buffer = ''
    
    socket.on('connect', () => {
      console.log(`[opencode-ntfy] Connected to service at ${socketPath}`)
      
      // Register session
      sendMessage({
        type: 'register',
        sessionId,
      })
    })
    
    socket.on('data', (data) => {
      buffer += data.toString()
      
      // Process complete messages (newline-delimited JSON)
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        
        if (!line.trim()) continue
        
        try {
          const message = JSON.parse(line)
          handleMessage(message, resolve)
        } catch (error) {
          console.warn(`[opencode-ntfy] Invalid message from service: ${error.message}`)
        }
      }
    })
    
    socket.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
        console.warn(`[opencode-ntfy] Service not running (${err.code})`)
      } else {
        console.warn(`[opencode-ntfy] Socket error: ${err.message}`)
      }
      socket = null
      resolve(false)
    })
    
    socket.on('close', () => {
      console.log('[opencode-ntfy] Disconnected from service')
      socket = null
      
      // Reject any pending nonce requests
      for (const [permissionId, { reject }] of pendingNonceRequests) {
        reject(new Error('Service connection closed'))
      }
      pendingNonceRequests.clear()
    })
  })
}

/**
 * Disconnect from the callback service
 */
export async function disconnectFromService() {
  if (socket) {
    socket.destroy()
    socket = null
  }
  sessionId = null
}

/**
 * Request a nonce from the service for a permission request
 * @param {string} permissionId - Permission request ID
 * @returns {Promise<string>} The generated nonce
 */
export function requestNonce(permissionId) {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error('Not connected to service'))
      return
    }
    
    // Store pending request
    pendingNonceRequests.set(permissionId, { resolve, reject })
    
    // Send request
    sendMessage({
      type: 'create_nonce',
      sessionId,
      permissionId,
    })
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (pendingNonceRequests.has(permissionId)) {
        pendingNonceRequests.delete(permissionId)
        reject(new Error('Nonce request timed out'))
      }
    }, 5000)
  })
}

/**
 * Send a message to the service
 * @param {Object} message - Message to send
 */
function sendMessage(message) {
  if (socket && !socket.destroyed) {
    socket.write(JSON.stringify(message) + '\n')
  }
}

/**
 * Handle a message from the service
 * @param {Object} message - Parsed message
 * @param {Function} [connectResolve] - Resolve function for connection promise
 */
function handleMessage(message, connectResolve) {
  switch (message.type) {
    case 'registered':
      console.log(`[opencode-ntfy] Session registered: ${message.sessionId}`)
      if (connectResolve) {
        connectResolve(true)
      }
      break
      
    case 'nonce_created':
      // Resolve pending nonce request
      const pending = pendingNonceRequests.get(message.permissionId)
      if (pending) {
        pendingNonceRequests.delete(message.permissionId)
        pending.resolve(message.nonce)
      }
      break
      
    case 'permission_response':
      // Forward to handler
      if (permissionHandler) {
        permissionHandler(message.permissionId, message.response)
      } else {
        console.warn(`[opencode-ntfy] Received permission response but no handler set`)
      }
      break
      
    default:
      console.warn(`[opencode-ntfy] Unknown message type from service: ${message.type}`)
  }
}
