// opencode-pilot plugin - Auto-start daemon when OpenCode launches
//
// Add "opencode-pilot" to your opencode.json plugins array to enable.
// The plugin checks if the daemon is running and starts it if needed.
// If the running daemon has a different version, it will be restarted.

import { existsSync, readFileSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'
import { getVersion } from '../service/version.js'

const DEFAULT_PORT = 4097
const CONFIG_PATH = join(homedir(), '.config', 'opencode', 'pilot', 'config.yaml')

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
 * Start the daemon as a detached background process
 */
function startDaemon() {
  try {
    const child = spawn('npx', ['opencode-pilot', 'start'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  } catch {
    // Ignore start errors
  }
}

/**
 * Stop the daemon synchronously
 */
function stopDaemon() {
  try {
    spawnSync('npx', ['opencode-pilot', 'stop'], {
      stdio: 'ignore',
      timeout: 10000,
    })
  } catch {
    // Ignore stop errors
  }
}

/**
 * OpenCode plugin that auto-starts the daemon if not running.
 * If a daemon is running with a different version, it will be restarted.
 */
export const PilotPlugin = async () => {
  const port = getPort()
  const ourVersion = getVersion()
  
  try {
    // Check if daemon is already running
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    })
    
    if (res.ok) {
      // Check version
      const data = await res.json()
      const runningVersion = data.version
      
      if (runningVersion && runningVersion !== ourVersion && ourVersion !== 'unknown') {
        // Version mismatch - restart daemon
        console.log(`[opencode-pilot] Version mismatch (running: ${runningVersion}, plugin: ${ourVersion}), restarting...`)
        stopDaemon()
        // Small delay to ensure port is released
        await new Promise(resolve => setTimeout(resolve, 500))
        startDaemon()
      }
      // else: same version, nothing to do
      return {}
    }
  } catch {
    // Not running or error, start it
    startDaemon()
  }
  
  return {}
}

export default PilotPlugin
