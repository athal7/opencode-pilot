// ntfy HTTP client for sending notifications

import { debug } from './logger.js'

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
 */
export async function sendNotification({ server, topic, title, message, priority, tags, authToken }) {
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
