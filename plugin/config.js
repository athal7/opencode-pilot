// Configuration management for opencode-pilot
// Reads from ~/.config/opencode-pilot/config.yaml
//
// Example config file (~/.config/opencode-pilot/config.yaml):
// notifications:
//   topic: my-secret-topic
//   server: https://ntfy.sh
//   idle_delay_ms: 300000
//   debug: true

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'

const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'opencode-pilot', 'config.yaml')

/**
 * Load configuration from config file
 * @param {string} [configPath] - Optional path to config file (for testing)
 */
export function loadConfig(configPath) {
  const actualPath = configPath || DEFAULT_CONFIG_PATH
  
  // Load config.yaml if it exists
  let fileConfig = {}
  if (existsSync(actualPath)) {
    try {
      const content = readFileSync(actualPath, 'utf8')
      const parsed = YAML.parse(content)
      // Extract notifications section
      fileConfig = parsed?.notifications || {}
    } catch (err) {
      // Silently ignore parse errors
    }
  }

  // Helper to get value with default
  const get = (key, defaultValue) => {
    if (fileConfig[key] !== undefined && fileConfig[key] !== '') {
      return fileConfig[key]
    }
    return defaultValue
  }

  // Helper to parse boolean
  const getBool = (key, defaultValue) => {
    const value = get(key, undefined)
    if (value === undefined) return defaultValue
    if (typeof value === 'boolean') return value
    return String(value).toLowerCase() !== 'false' && String(value) !== '0'
  }

  // Helper to parse int
  const getInt = (key, defaultValue) => {
    const value = get(key, undefined)
    if (value === undefined) return defaultValue
    if (typeof value === 'number') return value
    const parsed = parseInt(String(value), 10)
    return isNaN(parsed) ? defaultValue : parsed
  }

  return {
    topic: get('topic', null),
    server: get('server', 'https://ntfy.sh'),
    authToken: get('token', null),
    idleDelayMs: getInt('idle_delay_ms', 300000),
    errorNotify: getBool('error_notify', true),
    errorDebounceMs: getInt('error_debounce_ms', 60000),
    retryNotifyFirst: getBool('retry_notify_first', true),
    retryNotifyAfter: getInt('retry_notify_after', 3),
    idleNotify: getBool('idle_notify', true),
    debug: getBool('debug', false),
    debugPath: get('debug_path', null),
  }
}
