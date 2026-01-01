// opencode-ntfy - ntfy notification plugin for OpenCode
//
// This plugin sends notifications via ntfy.sh when:
// - Permission requests need approval (interactive, requires callbackHost)
// - Session goes idle after delay
// - Errors or retries occur
//
// Configuration via opencode.json "ntfy" key or environment variables.
// See README.md for full configuration options.

import { basename } from 'path'
import { sendNotification } from './notifier.js'
import { loadConfig } from './config.js'

// Load configuration from opencode.json and environment
const config = loadConfig()

export const Notify = async ({ $, client, directory }) => {
  if (!config.topic) {
    console.log('[opencode-ntfy] No topic configured, plugin disabled')
    return {}
  }

  console.log(`[opencode-ntfy] Initialized for topic: ${config.topic}`)
  if (config.callbackHost) {
    console.log(`[opencode-ntfy] Interactive mode enabled (callback: ${config.callbackHost}:${config.callbackPort})`)
  } else {
    console.log('[opencode-ntfy] Read-only mode (set callbackHost for interactive permissions)')
  }

  // TODO: Issue #4 - Start callback server if callbackHost is configured

  const dir = basename(process.cwd())
  let idleTimer = null

  return {
    event: async ({ event }) => {
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        if (status === 'idle' && !idleTimer) {
          idleTimer = setTimeout(async () => {
            // Clear timer reference immediately to prevent race conditions
            idleTimer = null
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: 'OpenCode',
              message: dir,
              authToken: config.authToken,
            })
          }, config.idleDelayMs)
        } else if (status === 'busy' && idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
      }
      // TODO: Issue #3 - Handle permission.updated events
      // TODO: Issue #7 - Handle error and retry events
    },
  }
}

export default Notify
