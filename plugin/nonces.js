// Single-use nonces for callback authentication
// Replaces HMAC tokens with simpler, replay-resistant approach
//
// Security model:
// - Nonces are cryptographically random UUIDs
// - Single-use: deleted immediately after consumption
// - TTL: expire after 1 hour if not consumed
// - In-memory storage (lost on restart, which is acceptable)

import { randomUUID } from 'crypto'

// In-memory storage: nonce -> { sessionId, permissionId, createdAt }
const pending = new Map()

// Nonces expire after 1 hour
const NONCE_TTL_MS = 60 * 60 * 1000

/**
 * Create a new single-use nonce for a permission request
 * @param {string} sessionId - OpenCode session ID
 * @param {string} permissionId - Permission request ID
 * @returns {string} The generated nonce (UUID)
 */
export function createNonce(sessionId, permissionId) {
  const nonce = randomUUID()
  pending.set(nonce, {
    sessionId,
    permissionId,
    createdAt: Date.now(),
  })
  return nonce
}

/**
 * Consume a nonce, returning its data if valid
 * Nonce is deleted after consumption (single-use)
 * @param {string} nonce - The nonce to consume
 * @returns {Object|null} { sessionId, permissionId } or null if invalid/expired
 */
export function consumeNonce(nonce) {
  const data = pending.get(nonce)
  
  if (!data) {
    return null
  }
  
  // Check TTL
  if (Date.now() - data.createdAt > NONCE_TTL_MS) {
    pending.delete(nonce)
    return null
  }
  
  // Single-use: delete on consumption
  pending.delete(nonce)
  
  return {
    sessionId: data.sessionId,
    permissionId: data.permissionId,
  }
}

/**
 * Clean up expired nonces (optional, for long-running processes)
 * @returns {number} Number of expired nonces removed
 */
export function cleanup() {
  const now = Date.now()
  let removed = 0
  
  for (const [nonce, data] of pending) {
    if (now - data.createdAt > NONCE_TTL_MS) {
      pending.delete(nonce)
      removed++
    }
  }
  
  return removed
}
