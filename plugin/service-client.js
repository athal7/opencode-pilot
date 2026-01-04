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
let socketPath = DEFAULT_SOCKET_PATH
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
  socketPath = options.socketPath || DEFAULT_SOCKET_PATH
  sessionId = options.sessionId
  
  return new Promise((resolve) => {
    // Create new socket and capture reference to avoid race conditions
    // When a connection fails, error and close events both fire. If a
    // reconnection succeeds before the old close event fires, the close
    // handler would incorrectly clear the new socket. By capturing the
    // socket reference in a closure and checking against it, we ensure
    // only events from the current socket affect the global state.
    const newSocket = createConnection(socketPath)
    socket = newSocket
    
    let buffer = ''
    
    newSocket.on('connect', () => {
      // Register session
      sendMessage({
        type: 'register',
        sessionId,
      })
    })
    
    newSocket.on('data', (data) => {
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
          // Silently ignore invalid messages
        }
      }
    })
    
    newSocket.on('error', (err) => {
      // Only clear global state if this is still the active socket
      if (socket === newSocket) {
        socket = null
      }
      resolve(false)
    })
    
    newSocket.on('close', () => {
      // Only clear global state if this is still the active socket
      // This prevents race conditions when a failed connection's close
      // event fires after a successful reconnection
      if (socket === newSocket) {
        socket = null
        
        // Reject any pending nonce requests
        for (const [permissionId, { reject }] of pendingNonceRequests) {
          reject(new Error('Service connection closed'))
        }
        pendingNonceRequests.clear()
      }
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
 * Try to reconnect to the callback service if disconnected
 * Uses the session ID from the last successful connection
 * @returns {Promise<boolean>} True if reconnected successfully
 */
export async function tryReconnect() {
  // If already connected, nothing to do
  if (isConnected()) {
    return true
  }
  
  // If we have a session ID from a previous connection, try to reconnect
  if (sessionId) {
    return connectToService({ sessionId, socketPath })
  }
  
  return false
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
      }
      break
      
    default:
      // Silently ignore unknown message types
      break
  }
}
