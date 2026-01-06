// Debug logging module for opencode-pilot plugin
// Writes to ~/.config/opencode-pilot/debug.log when enabled via NTFY_DEBUG=true or config.debug
//
// Uses async (fire-and-forget) writes to avoid blocking the render thread.
//
// Usage:
//   import { initLogger, debug } from './logger.js'
//   initLogger({ debug: true, debugPath: '/custom/path.log' })
//   debug('Event received', { type: 'session.status', status: 'idle' })

import { appendFile, stat, unlink, mkdir } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// Maximum log file size before rotation (1MB)
export const MAX_LOG_SIZE = 1024 * 1024

// Default log path
const DEFAULT_LOG_PATH = join(homedir(), '.config', 'opencode-pilot', 'debug.log')

// Module state
let enabled = false
let logPath = DEFAULT_LOG_PATH

// Write queue for batching
const writeQueue = []
let writeInProgress = false
let dirEnsured = false

/**
 * Initialize the logger with configuration
 * @param {Object} options
 * @param {boolean} [options.debug] - Enable debug logging
 * @param {string} [options.debugPath] - Custom log file path
 */
export function initLogger(options = {}) {
  // Check environment variables first, then options
  const envDebug = process.env.NTFY_DEBUG
  const envDebugPath = process.env.NTFY_DEBUG_PATH
  
  // Enable if NTFY_DEBUG is set to any truthy value (not 'false' or '0')
  if (envDebug !== undefined && envDebug !== '' && envDebug !== 'false' && envDebug !== '0') {
    enabled = true
  } else if (options.debug !== undefined) {
    enabled = Boolean(options.debug)
  } else {
    enabled = false
  }
  
  // Set log path (env var takes precedence)
  if (envDebugPath) {
    logPath = envDebugPath
  } else if (options.debugPath) {
    logPath = options.debugPath
  } else {
    logPath = DEFAULT_LOG_PATH
  }
  
  // Reset directory ensured flag when path changes
  dirEnsured = false
  
  // Create directory synchronously at init (one-time cost)
  if (enabled) {
    try {
      const dir = dirname(logPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      dirEnsured = true
    } catch {
      // Silently ignore directory creation errors
    }
  }
}

/**
 * Write a debug log entry (fire-and-forget, non-blocking)
 * @param {string} message - Log message
 * @param {Object} [data] - Optional data to include
 */
export function debug(message, data) {
  if (!enabled) {
    return
  }
  
  // Format log entry with ISO 8601 timestamp
  const timestamp = new Date().toISOString()
  let entry = `[${timestamp}] ${message}`
  
  // Append data if provided
  if (data !== undefined) {
    if (typeof data === 'object') {
      entry += ' ' + JSON.stringify(data)
    } else {
      entry += ' ' + String(data)
    }
  }
  
  entry += '\n'
  
  // Queue the entry and trigger async processing
  writeQueue.push(entry)
  processQueue()
}

/**
 * Process the write queue asynchronously
 * Batches multiple entries into a single write for efficiency
 */
async function processQueue() {
  // Prevent concurrent processing
  if (writeInProgress || writeQueue.length === 0) {
    return
  }
  
  writeInProgress = true
  
  try {
    // Ensure directory exists (async, but only if not already done)
    if (!dirEnsured) {
      const dir = dirname(logPath)
      await mkdir(dir, { recursive: true })
      dirEnsured = true
    }
    
    // Check file size and rotate if needed
    await rotateIfNeeded()
    
    // Drain queue into a single write
    const entries = writeQueue.splice(0, writeQueue.length).join('')
    
    // Append to log file
    await appendFile(logPath, entries)
  } catch {
    // Silently ignore write errors to avoid affecting the plugin
  } finally {
    writeInProgress = false
    
    // Process any entries that were queued during our write
    if (writeQueue.length > 0) {
      // Use setImmediate to avoid stack buildup
      setImmediate(processQueue)
    }
  }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 */
async function rotateIfNeeded() {
  try {
    const stats = await stat(logPath)
    if (stats.size > MAX_LOG_SIZE) {
      // Simple rotation: just truncate the file
      await unlink(logPath)
    }
  } catch {
    // File doesn't exist or other error - ignore
  }
}
