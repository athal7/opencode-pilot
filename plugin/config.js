// Configuration management for opencode-ntfy
// Reads from opencode.json "ntfy" key, with env var overrides
//
// Example opencode.json:
// {
//   "plugin": ["~/.config/opencode/plugins/opencode-ntfy"],
//   "ntfy": {
//     "topic": "my-secret-topic",
//     "server": "https://ntfy.sh",
//     "token": "tk_xxx",
//     "callbackHost": "myhost.ts.net",
//     "callbackPort": 4097,
//     "idleDelayMs": 300000
//   }
// }

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const OPENCODE_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json')

/**
 * Load configuration from opencode.json and environment
 * Priority: env vars > opencode.json "ntfy" key > defaults
 */
export function loadConfig() {
  // Load opencode.json if it exists
  let fileConfig = {}
  if (existsSync(OPENCODE_CONFIG_PATH)) {
    try {
      const content = readFileSync(OPENCODE_CONFIG_PATH, 'utf8')
      const opencode = JSON.parse(content)
      fileConfig = opencode.ntfy || {}
      if (Object.keys(fileConfig).length > 0) {
        console.log('[opencode-ntfy] Loaded config from opencode.json')
      }
    } catch (err) {
      console.warn(`[opencode-ntfy] Failed to parse opencode.json: ${err.message}`)
    }
  }

  // Helper to get value with priority: env > file > default
  const get = (envKey, fileKey, defaultValue) => {
    if (process.env[envKey] !== undefined && process.env[envKey] !== '') {
      return process.env[envKey]
    }
    if (fileConfig[fileKey] !== undefined) {
      return fileConfig[fileKey]
    }
    return defaultValue
  }

  // Helper to parse boolean
  const getBool = (envKey, fileKey, defaultValue) => {
    const value = get(envKey, fileKey, undefined)
    if (value === undefined) return defaultValue
    if (typeof value === 'boolean') return value
    return String(value).toLowerCase() !== 'false' && String(value) !== '0'
  }

  // Helper to parse int
  const getInt = (envKey, fileKey, defaultValue) => {
    const value = get(envKey, fileKey, undefined)
    if (value === undefined) return defaultValue
    if (typeof value === 'number') return value
    const parsed = parseInt(String(value), 10)
    return isNaN(parsed) ? defaultValue : parsed
  }

  return {
    topic: get('NTFY_TOPIC', 'topic', null),
    server: get('NTFY_SERVER', 'server', 'https://ntfy.sh'),
    authToken: get('NTFY_TOKEN', 'token', null),
    callbackHost: get('NTFY_CALLBACK_HOST', 'callbackHost', null),
    callbackPort: getInt('NTFY_CALLBACK_PORT', 'callbackPort', 4097),
    idleDelayMs: getInt('NTFY_IDLE_DELAY_MS', 'idleDelayMs', 300000),
    errorNotify: getBool('NTFY_ERROR_NOTIFY', 'errorNotify', true),
    errorDebounceMs: getInt('NTFY_ERROR_DEBOUNCE_MS', 'errorDebounceMs', 60000),
    retryNotifyFirst: getBool('NTFY_RETRY_NOTIFY_FIRST', 'retryNotifyFirst', true),
    retryNotifyAfter: getInt('NTFY_RETRY_NOTIFY_AFTER', 'retryNotifyAfter', 3),
  }
}

/**
 * Get the callback host from config
 * @param {Object} config - Config object from loadConfig()
 * @returns {string} The callback host
 */
export function getCallbackHost(config) {
  if (config.callbackHost) {
    console.log(`[opencode-ntfy] Using callback host: ${config.callbackHost}`)
    return config.callbackHost
  }

  console.warn('[opencode-ntfy] callbackHost not configured, using localhost (interactive features local-only)')
  return 'localhost'
}
