import { test } from 'node:test'
import assert from 'node:assert'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getOrCreateAuthToken, readAuthToken } from '../../service/auth.js'

test('creates a stable owner-only authentication token', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-auth-'))
  const tokenPath = join(tempDir, 'server.token')

  try {
    const token = getOrCreateAuthToken(tokenPath)
    assert.strictEqual(token.length, 64)
    assert.strictEqual(readFileSync(tokenPath, 'utf8'), token)
    assert.strictEqual(readAuthToken(tokenPath), token)
    assert.strictEqual(getOrCreateAuthToken(tokenPath), token)
    assert.strictEqual(statSync(tokenPath).mode & 0o777, 0o600)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('rejects token files with unsafe permissions', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-auth-'))
  const tokenPath = join(tempDir, 'server.token')

  try {
    getOrCreateAuthToken(tokenPath)
    chmodSync(tokenPath, 0o644)

    assert.throws(() => readAuthToken(tokenPath), /unsafe permissions/)
    assert.throws(() => getOrCreateAuthToken(tokenPath), /unsafe permissions/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
