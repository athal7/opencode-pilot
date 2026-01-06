// opencode-pilot plugin - Auto-start daemon when OpenCode launches
//
// Add "opencode-pilot" to your opencode.json plugins array to enable.
// The plugin checks if the daemon is running and starts it if needed.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'

const DEFAULT_PORT = 4097
const CONFIG_PATH = join(homedir(), '.config', 'opencode-pilot', 'config.yaml')

/**
 * Load port from config file
 * @returns {number} Port number
 */
function getPort() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf8')
      const config = YAML.parse(content)
      if (config?.port && typeof config.port === 'number') {
        return config.port
      }
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_PORT
}

/**
 * OpenCode plugin that auto-starts the daemon if not running
 */
export const PilotPlugin = async ({ $ }) => {
  const port = getPort()
  
  try {
    // Check if daemon is already running
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    })
    if (res.ok) {
      // Already running, nothing to do
      return {}
    }
  } catch {
    // Not running, start it
    try {
      await $`opencode-pilot start &`.quiet()
    } catch {
      // Ignore start errors (maybe already starting)
    }
  }
  
  return {}
}

export default PilotPlugin
