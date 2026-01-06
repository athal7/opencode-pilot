// Standalone server for opencode-pilot
//
// This service runs persistently and handles:
// - Polling for tracker items (GitHub issues, Linear issues)
// - Health check endpoint

import { createServer as createHttpServer } from 'http'
import { existsSync, realpathSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { join } from 'path'
import YAML from 'yaml'

// Default configuration
const DEFAULT_HTTP_PORT = 4097
const DEFAULT_REPOS_CONFIG = join(homedir(), '.config', 'opencode-pilot', 'config.yaml')
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes

/**
 * Load port from config file
 * @returns {number} Port number
 */
function getPortFromConfig() {
  try {
    if (existsSync(DEFAULT_REPOS_CONFIG)) {
      const content = readFileSync(DEFAULT_REPOS_CONFIG, 'utf8')
      const config = YAML.parse(content)
      if (config?.port && typeof config.port === 'number') {
        return config.port
      }
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_HTTP_PORT
}

/**
 * Create the HTTP server (health check only)
 * @param {number} port - Port to listen on
 * @returns {http.Server} The HTTP server
 */
function createHttpServer_(port) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    
    // OPTIONS - CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }
    
    // GET /health - Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    
    // Unknown route
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })
  
  server.on('error', (err) => {
    console.error(`[opencode-pilot] HTTP server error: ${err.message}`)
  })
  
  return server
}

/**
 * Start the service
 * @param {Object} config - Configuration options
 * @param {number} [config.httpPort] - HTTP server port (default: 4097)
 * @param {boolean} [config.enablePolling] - Enable polling for tracker items (default: true)
 * @param {number} [config.pollInterval] - Poll interval in ms (default: 5 minutes)
 * @param {string} [config.reposConfig] - Path to config.yaml
 * @returns {Promise<Object>} Service instance with httpServer and polling state
 */
export async function startService(config = {}) {
  const httpPort = config.httpPort ?? DEFAULT_HTTP_PORT
  const enablePolling = config.enablePolling !== false
  const pollInterval = config.pollInterval ?? DEFAULT_POLL_INTERVAL
  const reposConfig = config.reposConfig ?? DEFAULT_REPOS_CONFIG
  
  // Create HTTP server
  const httpServer = createHttpServer_(httpPort)
  
  // Start HTTP server
  await new Promise((resolve, reject) => {
    httpServer.listen(httpPort, () => {
      const actualPort = httpServer.address().port
      console.log(`[opencode-pilot] HTTP server listening on port ${actualPort}`)
      resolve()
    })
    httpServer.once('error', reject)
  })
  
  // Start polling for tracker items if config exists
  let pollingState = null
  if (enablePolling && existsSync(reposConfig)) {
    try {
      // Dynamic import to avoid circular dependencies
      const { startPolling } = await import('./poll-service.js')
      pollingState = startPolling({
        configPath: reposConfig,
        interval: pollInterval,
      })
      console.log(`[opencode-pilot] Polling enabled with config: ${reposConfig}`)
    } catch (err) {
      console.warn(`[opencode-pilot] Could not start polling: ${err.message}`)
    }
  } else if (enablePolling) {
    console.log(`[opencode-pilot] Polling disabled (no config.yaml at ${reposConfig})`)
  }
  
  return {
    httpServer,
    pollingState,
  }
}

/**
 * Stop the service
 * @param {Object} service - Service instance from startService
 */
export async function stopService(service) {
  // Stop polling if active
  if (service.pollingState) {
    service.pollingState.stop()
  }
  
  if (service.httpServer) {
    await new Promise((resolve) => {
      service.httpServer.close(resolve)
    })
  }
  
  console.log('[opencode-pilot] Service stopped')
}

// Check if this is the main module
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
    httpPort: getPortFromConfig(),
  }
  
  console.log('[opencode-pilot] Starting service...')
  
  startService(config).then((service) => {
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('[opencode-pilot] Received SIGTERM, shutting down...')
      await stopService(service)
      process.exit(0)
    })
    
    process.on('SIGINT', async () => {
      console.log('[opencode-pilot] Received SIGINT, shutting down...')
      await stopService(service)
      process.exit(0)
    })
  }).catch((err) => {
    console.error(`[opencode-pilot] Failed to start: ${err.message}`)
    process.exit(1)
  })
}
