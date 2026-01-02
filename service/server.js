// Standalone callback server for opencode-ntfy
// Implements Issue #13: Separate callback server as brew service
//
// This service runs persistently via brew services and handles:
// - HTTP callbacks from ntfy action buttons
// - Unix socket IPC for plugin communication
// - Nonce management for permission requests
// - Session registration and response forwarding

import { createServer as createHttpServer } from 'http'
import { createServer as createNetServer } from 'net'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync, realpathSync } from 'fs'
import { fileURLToPath } from 'url'

// Default configuration
const DEFAULT_HTTP_PORT = 4097
const DEFAULT_SOCKET_PATH = '/tmp/opencode-ntfy.sock'

// Nonce storage: nonce -> { sessionId, permissionId, createdAt }
const nonces = new Map()
const NONCE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Session storage: sessionId -> socket connection
const sessions = new Map()

// Valid response types
const VALID_RESPONSES = ['once', 'always', 'reject']

/**
 * Create a nonce for a permission request
 * @param {string} sessionId - OpenCode session ID
 * @param {string} permissionId - Permission request ID
 * @returns {string} The generated nonce
 */
function createNonce(sessionId, permissionId) {
  const nonce = randomUUID()
  nonces.set(nonce, {
    sessionId,
    permissionId,
    createdAt: Date.now(),
  })
  return nonce
}

/**
 * Consume a nonce, returning its data if valid
 * @param {string} nonce - The nonce to consume
 * @returns {Object|null} { sessionId, permissionId } or null if invalid/expired
 */
function consumeNonce(nonce) {
  const data = nonces.get(nonce)
  if (!data) return null
  
  nonces.delete(nonce)
  
  if (Date.now() - data.createdAt > NONCE_TTL_MS) {
    return null
  }
  
  return {
    sessionId: data.sessionId,
    permissionId: data.permissionId,
  }
}

/**
 * Clean up expired nonces
 * @returns {number} Number of expired nonces removed
 */
function cleanupNonces() {
  const now = Date.now()
  let removed = 0
  
  for (const [nonce, data] of nonces) {
    if (now - data.createdAt > NONCE_TTL_MS) {
      nonces.delete(nonce)
      removed++
    }
  }
  
  return removed
}

/**
 * Register a session connection
 * @param {string} sessionId - OpenCode session ID
 * @param {net.Socket} socket - Socket connection to the plugin
 */
function registerSession(sessionId, socket) {
  console.log(`[opencode-ntfy] Session registered: ${sessionId}`)
  sessions.set(sessionId, socket)
  
  socket.on('close', () => {
    console.log(`[opencode-ntfy] Session disconnected: ${sessionId}`)
    sessions.delete(sessionId)
  })
}

/**
 * Send a permission response to a session
 * @param {string} sessionId - OpenCode session ID
 * @param {string} permissionId - Permission request ID
 * @param {string} response - Response type: 'once' | 'always' | 'reject'
 * @returns {boolean} True if sent successfully
 */
function sendToSession(sessionId, permissionId, response) {
  const socket = sessions.get(sessionId)
  if (!socket) {
    console.warn(`[opencode-ntfy] Session not found: ${sessionId}`)
    return false
  }
  
  try {
    const message = JSON.stringify({
      type: 'permission_response',
      permissionId,
      response,
    })
    socket.write(message + '\n')
    return true
  } catch (error) {
    console.error(`[opencode-ntfy] Failed to send to session ${sessionId}: ${error.message}`)
    return false
  }
}

/**
 * Create the HTTP callback server
 * @param {number} port - Port to listen on
 * @returns {http.Server} The HTTP server
 */
function createCallbackServer(port) {
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    
    // GET /health - Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    
    // POST /callback - Permission response from ntfy
    if (req.method === 'POST' && url.pathname === '/callback') {
      const nonce = url.searchParams.get('nonce')
      const response = url.searchParams.get('response')
      
      // Validate required params
      if (!nonce || !response) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing required parameters')
        return
      }
      
      // Validate response value
      if (!VALID_RESPONSES.includes(response)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid response value')
        return
      }
      
      // Validate and consume nonce
      const payload = consumeNonce(nonce)
      if (!payload) {
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Invalid or expired nonce')
        return
      }
      
      // Forward to session
      const sent = sendToSession(payload.sessionId, payload.permissionId, response)
      if (sent) {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('Session not connected')
      }
      return
    }
    
    // Unknown route
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })
  
  server.on('error', (err) => {
    console.error(`[opencode-ntfy] HTTP server error: ${err.message}`)
  })
  
  return server
}

/**
 * Create the Unix socket server for IPC
 * @param {string} socketPath - Path to the socket file
 * @returns {net.Server} The socket server
 */
function createSocketServer(socketPath) {
  const server = createNetServer((socket) => {
    console.log('[opencode-ntfy] Plugin connected')
    
    let buffer = ''
    
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
          handleSocketMessage(socket, message)
        } catch (error) {
          console.warn(`[opencode-ntfy] Invalid message: ${error.message}`)
        }
      }
    })
    
    socket.on('error', (err) => {
      console.warn(`[opencode-ntfy] Socket error: ${err.message}`)
    })
  })
  
  server.on('error', (err) => {
    console.error(`[opencode-ntfy] Socket server error: ${err.message}`)
  })
  
  return server
}

/**
 * Handle a message from a plugin
 * @param {net.Socket} socket - The socket connection
 * @param {Object} message - The parsed message
 */
function handleSocketMessage(socket, message) {
  switch (message.type) {
    case 'register':
      if (message.sessionId) {
        registerSession(message.sessionId, socket)
        socket.write(JSON.stringify({ type: 'registered', sessionId: message.sessionId }) + '\n')
      }
      break
      
    case 'create_nonce':
      if (message.sessionId && message.permissionId) {
        const nonce = createNonce(message.sessionId, message.permissionId)
        socket.write(JSON.stringify({ type: 'nonce_created', nonce, permissionId: message.permissionId }) + '\n')
      }
      break
      
    default:
      console.warn(`[opencode-ntfy] Unknown message type: ${message.type}`)
  }
}

/**
 * Start the callback service
 * @param {Object} config - Configuration options
 * @param {number} [config.httpPort] - HTTP server port (default: 4097)
 * @param {string} [config.socketPath] - Unix socket path (default: /tmp/opencode-ntfy.sock)
 * @returns {Promise<Object>} Service instance with httpServer, socketServer, and cleanup interval
 */
export async function startService(config = {}) {
  const httpPort = config.httpPort ?? DEFAULT_HTTP_PORT
  const socketPath = config.socketPath ?? DEFAULT_SOCKET_PATH
  
  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch (err) {
      console.warn(`[opencode-ntfy] Could not remove stale socket: ${err.message}`)
    }
  }
  
  // Create servers
  const httpServer = createCallbackServer(httpPort)
  const socketServer = createSocketServer(socketPath)
  
  // Start HTTP server
  await new Promise((resolve, reject) => {
    httpServer.listen(httpPort, () => {
      const actualPort = httpServer.address().port
      console.log(`[opencode-ntfy] HTTP server listening on port ${actualPort}`)
      resolve()
    })
    httpServer.once('error', reject)
  })
  
  // Start socket server
  await new Promise((resolve, reject) => {
    socketServer.listen(socketPath, () => {
      console.log(`[opencode-ntfy] Socket server listening at ${socketPath}`)
      resolve()
    })
    socketServer.once('error', reject)
  })
  
  // Start periodic nonce cleanup
  const cleanupInterval = setInterval(() => {
    const removed = cleanupNonces()
    if (removed > 0) {
      console.log(`[opencode-ntfy] Cleaned up ${removed} expired nonces`)
    }
  }, 60 * 1000) // Every minute
  
  return {
    httpServer,
    socketServer,
    cleanupInterval,
    socketPath,
  }
}

/**
 * Stop the callback service
 * @param {Object} service - Service instance from startService
 */
export async function stopService(service) {
  if (service.cleanupInterval) {
    clearInterval(service.cleanupInterval)
  }
  
  if (service.httpServer) {
    await new Promise((resolve) => {
      service.httpServer.close(resolve)
    })
  }
  
  if (service.socketServer) {
    await new Promise((resolve) => {
      service.socketServer.close(resolve)
    })
  }
  
  // Clean up socket file
  if (service.socketPath && existsSync(service.socketPath)) {
    try {
      unlinkSync(service.socketPath)
    } catch (err) {
      // Ignore errors
    }
  }
  
  console.log('[opencode-ntfy] Service stopped')
}

// If run directly, start the service
// Use realpath comparison to handle symlinks (e.g., /tmp vs /private/tmp on macOS,
// or /opt/homebrew/opt vs /opt/homebrew/Cellar)
function isMainModule() {
  try {
    const currentFile = realpathSync(fileURLToPath(import.meta.url))
    const argvFile = realpathSync(process.argv[1])
    return currentFile === argvFile
  } catch {
    return false
  }
}

if (isMainModule()) {
  const config = {
    httpPort: parseInt(process.env.NTFY_CALLBACK_PORT || '4097', 10),
    socketPath: process.env.NTFY_SOCKET_PATH || DEFAULT_SOCKET_PATH,
  }
  
  console.log('[opencode-ntfy] Starting callback service...')
  
  const service = await startService(config)
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[opencode-ntfy] Received SIGTERM, shutting down...')
    await stopService(service)
    process.exit(0)
  })
  
  process.on('SIGINT', async () => {
    console.log('[opencode-ntfy] Received SIGINT, shutting down...')
    await stopService(service)
    process.exit(0)
  })
}
