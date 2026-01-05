/**
 * utils.js - Shared utility functions
 *
 * Common helpers used across service modules.
 */

/**
 * Get a nested field value from an object using dot notation
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., "repository.full_name")
 * @returns {*} Value at path, or undefined if not found
 */
export function getNestedValue(obj, path) {
  const parts = path.split(".");
  let value = obj;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  return value;
}
