// Debug logging module for opencode-pilot plugin
// Writes to ~/.config/opencode-pilot/debug.log when enabled via NTFY_DEBUG=true or config.debug
//
// Usage:
//   import { initLogger, debug } from './logger.js'
//   initLogger({ debug: true, debugPath: '/custom/path.log' })
//   debug('Event received', { type: 'session.status', status: 'idle' })

import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// Maximum log file size before rotation (1MB)
export const MAX_LOG_SIZE = 1024 * 1024

// Default log path
const DEFAULT_LOG_PATH = join(homedir(), '.config', 'opencode-pilot', 'debug.log')

// Module state
let enabled = false
let logPath = DEFAULT_LOG_PATH

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
  
  // Create directory if it doesn't exist
  if (enabled) {
    try {
      const dir = dirname(logPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    } catch {
      // Silently ignore directory creation errors
    }
  }
}

/**
 * Write a debug log entry
 * @param {string} message - Log message
 * @param {Object} [data] - Optional data to include
 */
export function debug(message, data) {
  if (!enabled) {
    return
  }
  
  try {
    // Check file size and rotate if needed
    rotateIfNeeded()
    
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
    
    // Ensure directory exists
    const dir = dirname(logPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    // Append to log file
    appendFileSync(logPath, entry)
  } catch {
    // Silently ignore write errors to avoid affecting the plugin
  }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 */
function rotateIfNeeded() {
  try {
    if (!existsSync(logPath)) {
      return
    }
    
    const stats = statSync(logPath)
    if (stats.size > MAX_LOG_SIZE) {
      // Simple rotation: just truncate the file
      // For more sophisticated rotation, could rename to .old first
      unlinkSync(logPath)
    }
  } catch {
    // Silently ignore rotation errors
  }
}
