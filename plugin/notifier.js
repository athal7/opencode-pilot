// ntfy HTTP client for sending notifications
// Implements Issue #3: Notifier module

import { debug } from './logger.js'

const MAX_COMMAND_LENGTH = 100

// Deduplication cache: track recently sent notifications to prevent duplicates
// Key: hash of notification content, Value: timestamp
const recentNotifications = new Map()
const DEDUPE_WINDOW_MS = 5000 // 5 seconds

/**
 * Generate a simple hash for deduplication
 * @param {string} str - String to hash
 * @returns {string} Simple hash
 */
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

/**
 * Check if notification was recently sent (for deduplication)
 * @param {string} key - Deduplication key
 * @returns {boolean} True if duplicate
 */
function isDuplicate(key) {
  const now = Date.now()
  
  // Clean up old entries
  for (const [k, timestamp] of recentNotifications) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentNotifications.delete(k)
    }
  }
  
  if (recentNotifications.has(key)) {
    return true
  }
  
  recentNotifications.set(key, now)
  return false
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string (empty string if input is falsy)
 */
function truncate(str, maxLength) {
  if (!str) {
    return ''
  }
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Build headers for ntfy requests
 * @param {string} [authToken] - Optional ntfy access token for Bearer auth
 * @returns {Object} Headers object
 */
function buildHeaders(authToken) {
  const headers = {
    'Content-Type': 'application/json',
  }
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }
  
  return headers
}

/**
 * Send a basic notification to ntfy
 * @param {Object} options
 * @param {string} options.server - ntfy server URL
 * @param {string} options.topic - ntfy topic name
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {number} [options.priority] - Priority (1-5, default 3)
 * @param {string[]} [options.tags] - Emoji tags
 * @param {string} [options.authToken] - Optional ntfy access token for protected topics
 * @param {Object[]} [options.actions] - Optional action buttons (see ntfy docs)
 */
export async function sendNotification({ server, topic, title, message, priority, tags, authToken, actions }) {
  // Deduplicate: skip if same notification sent recently
  const dedupeKey = simpleHash(`${topic}:${title}:${message}`)
  if (isDuplicate(dedupeKey)) {
    debug(`Notification skipped (duplicate): ${title}`)
    return
  }

  const body = {
    topic,
    title,
    message,
  }

  // Add optional fields only if provided
  if (priority !== undefined) {
    body.priority = priority
  }
  if (tags && tags.length > 0) {
    body.tags = tags
  }
  if (actions && actions.length > 0) {
    body.actions = actions
  }

  try {
    debug(`Notification sending: ${title}`)
    const response = await fetch(server, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(body),
    })
    debug(`Notification sent: ${title} (status=${response.status})`)
  } catch (error) {
    debug(`Notification failed: ${title} (error=${error.message})`)
    // Silently ignore - errors here shouldn't affect the user
  }
}

/**
 * Send a permission notification with action buttons
 * @param {Object} options
 * @param {string} options.server - ntfy server URL
 * @param {string} options.topic - ntfy topic name
 * @param {string} options.callbackUrl - Base URL for callbacks
 * @param {string} options.nonce - Single-use nonce for callback authentication
 * @param {string} options.tool - Tool requesting permission (e.g., "bash", "edit")
 * @param {string} options.command - The actual command or pattern being requested
 * @param {string} options.repoName - Repository/directory name for context
 * @param {string} [options.authToken] - Optional ntfy access token for protected topics
 */
export async function sendPermissionNotification({
  server,
  topic,
  callbackUrl,
  nonce,
  tool,
  command,
  repoName,
  authToken,
}) {
  // Deduplicate: skip if same permission notification sent recently
  // Use tool+command+repoName (not nonce, which is unique per request)
  const dedupeKey = simpleHash(`perm:${topic}:${tool}:${command}:${repoName}`)
  if (isDuplicate(dedupeKey)) {
    debug(`Permission notification skipped (duplicate): ${tool}`)
    return
  }

  const truncatedCommand = truncate(command, MAX_COMMAND_LENGTH)
  const body = {
    topic,
    title: `Approve? (${repoName})`,
    message: `${tool}: ${truncatedCommand}`,
    priority: 4,
    tags: ['lock'],
    actions: [
      {
        action: 'view',
        label: 'Allow Once',
        url: `${callbackUrl}?nonce=${nonce}&response=once`,
        clear: true,
      },
      {
        action: 'view',
        label: 'Allow Always',
        url: `${callbackUrl}?nonce=${nonce}&response=always`,
        clear: true,
      },
      {
        action: 'view',
        label: 'Reject',
        url: `${callbackUrl}?nonce=${nonce}&response=reject`,
        clear: true,
      },
    ],
  }

  try {
    debug(`Permission notification sending: ${tool} for ${repoName}`)
    const response = await fetch(server, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(body),
    })
    debug(`Permission notification sent: ${tool} (status=${response.status})`)
  } catch (error) {
    debug(`Permission notification failed: ${tool} (error=${error.message})`)
    // Silently ignore - errors here shouldn't affect the user
  }
}
