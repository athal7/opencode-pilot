// Callback host configuration
// Implements Issue #6: Host discovery module
//
// Note: This module is kept for backwards compatibility.
// Prefer using config.js getCallbackHost() directly.

/**
 * Get the callback host for ntfy action buttons
 * Uses NTFY_CALLBACK_HOST env var, falls back to localhost
 *
 * @returns {string} The callback host
 */
export function getCallbackHost() {
  if (process.env.NTFY_CALLBACK_HOST) {
    console.log(`[opencode-ntfy] Using callback host: ${process.env.NTFY_CALLBACK_HOST}`)
    return process.env.NTFY_CALLBACK_HOST
  }

  console.warn('[opencode-ntfy] NTFY_CALLBACK_HOST not set, using localhost (interactive features local-only)')
  return 'localhost'
}

// Alias for backwards compatibility
export const discoverCallbackHost = () => getCallbackHost()
