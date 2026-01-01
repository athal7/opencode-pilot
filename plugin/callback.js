// HTTP callback server for permission responses
// Implements Issue #4: Callback server module

import { createServer } from 'http'
import { consumeNonce } from './nonces.js'

const VALID_RESPONSES = ['once', 'always', 'reject']

/**
 * Start the HTTP callback server
 * @param {number} port - Port to listen on
 * @param {Function} onPermissionResponse - Callback when permission response received
 *   Called with (sessionId, permissionId, response) where response is 'once'|'always'|'reject'
 * @returns {import('http').Server} The HTTP server instance
 */
export function startCallbackServer(port, onPermissionResponse) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)

    // GET /health - Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }

    // POST /callback - Permission response
    if (req.method === 'POST' && url.pathname === '/callback') {
      const nonce = url.searchParams.get('nonce')
      const response = url.searchParams.get('response')

      // Validate required params first (before consuming nonce)
      if (!nonce || !response) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing required parameters')
        return
      }

      // Validate response value before consuming nonce
      // This prevents burning nonces with invalid responses
      if (!VALID_RESPONSES.includes(response)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid response value')
        return
      }

      // Validate and consume nonce (single-use)
      const payload = consumeNonce(nonce)
      if (!payload) {
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Invalid or expired nonce')
        return
      }

      // Call the handler
      try {
        await onPermissionResponse(payload.sessionId, payload.permissionId, response)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
      } catch (error) {
        console.warn(`[opencode-ntfy] Error handling permission response: ${error.message}`)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal server error')
      }
      return
    }

    // Unknown route
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  server.on('error', (err) => {
    console.error(`[opencode-ntfy] Callback server error: ${err.message}`)
  })

  server.listen(port, () => {
    console.log(`[opencode-ntfy] Callback server listening on port ${port}`)
  })

  return server
}
