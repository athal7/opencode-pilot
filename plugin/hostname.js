// Callback host configuration
// Implements Issue #6: Host discovery module
//
// Note: This module is kept for backwards compatibility.
// Prefer using config.js loadConfig().callbackHost directly.

import { loadConfig, getCallbackHost as getHostFromConfig } from './config.js'

/**
 * Get the callback host for ntfy action buttons
 * Uses NTFY_CALLBACK_HOST env var or opencode.json config
 *
 * @returns {string|null} The callback host, or null if not configured
 */
export function getCallbackHost() {
  const config = loadConfig()
  return getHostFromConfig(config)
}

// Alias for backwards compatibility
export const discoverCallbackHost = () => getCallbackHost()
