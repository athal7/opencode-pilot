// ntfy HTTP client for sending notifications
// Implements Issue #3: Notifier module

const MAX_COMMAND_LENGTH = 100

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) {
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
 */
export async function sendNotification({ server, topic, title, message, priority, tags, authToken }) {
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
    const response = await fetch(server, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.warn(`[opencode-ntfy] Notification failed: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.warn(`[opencode-ntfy] Failed to send notification: ${error.message}`)
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
  const truncatedCommand = truncate(command, MAX_COMMAND_LENGTH)
  const body = {
    topic,
    title: `Approve? (${repoName})`,
    message: `${tool}: ${truncatedCommand}`,
    priority: 4,
    tags: ['lock'],
    actions: [
      {
        action: 'http',
        label: 'Allow Once',
        url: `${callbackUrl}?nonce=${nonce}&response=once`,
        method: 'POST',
        clear: true,
      },
      {
        action: 'http',
        label: 'Allow Always',
        url: `${callbackUrl}?nonce=${nonce}&response=always`,
        method: 'POST',
        clear: true,
      },
      {
        action: 'http',
        label: 'Reject',
        url: `${callbackUrl}?nonce=${nonce}&response=reject`,
        method: 'POST',
        clear: true,
      },
    ],
  }

  try {
    const response = await fetch(server, {
      method: 'POST',
      headers: buildHeaders(authToken),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.warn(`[opencode-ntfy] Permission notification failed: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.warn(`[opencode-ntfy] Failed to send permission notification: ${error.message}`)
  }
}
