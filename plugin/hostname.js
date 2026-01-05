// Callback host configuration
// Implements Issue #6: Host discovery module
//
// Note: This module returns null since callback_host was removed from config.
// The callback functionality is no longer used.

import { loadConfig } from './config.js'

/**
 * Get the callback host for ntfy action buttons
 * 
 * Note: This always returns null as callback_host is no longer configured.
 * Kept for backwards compatibility with any code that imports this.
 *
 * @returns {null} Always returns null
 */
export function getCallbackHost() {
  return null
}

// Alias for backwards compatibility
export const discoverCallbackHost = () => getCallbackHost()
