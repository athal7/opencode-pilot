// opencode-ntfy - ntfy notification plugin for OpenCode
//
// This plugin sends notifications via ntfy.sh when:
// - Permission requests need approval (interactive)
// - Session goes idle after delay
// - Errors or retries occur
//
// Configuration via environment variables:
//   NTFY_TOPIC (required) - Your ntfy topic name
//   NTFY_SERVER - ntfy server URL (default: https://ntfy.sh)
//   NTFY_TOKEN - ntfy access token for protected topics (optional)
//   NTFY_CALLBACK_HOST - Callback host for action buttons (auto-discover)
//   NTFY_CALLBACK_PORT - Callback server port (default: 4097)
//   NTFY_IDLE_DELAY_MS - Idle notification delay in ms (default: 300000)
//   NTFY_ERROR_NOTIFY - Enable error notifications (default: true)
//   NTFY_ERROR_DEBOUNCE_MS - Error debounce window in ms (default: 60000)
//   NTFY_RETRY_NOTIFY_FIRST - Notify on first retry (default: true)
//   NTFY_RETRY_NOTIFY_AFTER - Also notify after N retries (default: 3)

import { sendNotification } from './notifier.js'

// Helper to parse boolean env vars
const parseBool = (value, defaultValue) => {
  if (value === undefined || value === '') return defaultValue
  return value.toLowerCase() !== 'false' && value !== '0'
}

// Configuration from environment
const config = {
  topic: process.env.NTFY_TOPIC,
  server: process.env.NTFY_SERVER || 'https://ntfy.sh',
  authToken: process.env.NTFY_TOKEN || null, // Optional: for protected topics
  callbackPort: parseInt(process.env.NTFY_CALLBACK_PORT || '4097', 10),
  idleDelayMs: parseInt(process.env.NTFY_IDLE_DELAY_MS || '300000', 10),
  errorNotify: parseBool(process.env.NTFY_ERROR_NOTIFY, true),
  errorDebounceMs: parseInt(process.env.NTFY_ERROR_DEBOUNCE_MS || '60000', 10),
  retryNotifyFirst: parseBool(process.env.NTFY_RETRY_NOTIFY_FIRST, true),
  retryNotifyAfter: parseInt(process.env.NTFY_RETRY_NOTIFY_AFTER || '3', 10),
}

export const Notify = async ({ $, client, directory }) => {
  if (!config.topic) {
    console.log('[opencode-ntfy] NTFY_TOPIC not set, plugin disabled')
    return {}
  }

  console.log(`[opencode-ntfy] Initialized for topic: ${config.topic}`)

  // TODO: Issue #6 - Discover callback host
  // TODO: Issue #4 - Start callback server

  const cwd = process.cwd()
  const dir = cwd.split('/').pop() || cwd
  let idleTimer = null

  return {
    event: async ({ event }) => {
      if (event.type === 'session.status') {
        const status = event.properties?.status?.type
        if (status === 'idle' && !idleTimer) {
          idleTimer = setTimeout(async () => {
            await sendNotification({
              server: config.server,
              topic: config.topic,
              title: 'OpenCode',
              message: dir,
              authToken: config.authToken,
            })
            idleTimer = null
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
