import { randomBytes, timingSafeEqual } from 'crypto'
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export const DEFAULT_AUTH_TOKEN_PATH = join(homedir(), '.config', 'opencode', 'pilot', 'server.token')

function assertSecureTokenFile(tokenPath) {
  const fileStats = lstatSync(tokenPath)
  if (fileStats.isSymbolicLink()) {
    throw new Error(`Authentication token must not be a symbolic link: ${tokenPath}`)
  }
  if ((fileStats.mode & 0o777) !== 0o600) {
    throw new Error(`Authentication token has unsafe permissions: ${tokenPath}`)
  }
  if (typeof process.getuid === 'function' && fileStats.uid !== process.getuid()) {
    throw new Error(`Authentication token has unsafe ownership: ${tokenPath}`)
  }
}

export function readAuthToken(tokenPath = DEFAULT_AUTH_TOKEN_PATH) {
  try {
    assertSecureTokenFile(tokenPath)
    const token = readFileSync(tokenPath, 'utf8').trim()
    return token || null
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

export function getOrCreateAuthToken(tokenPath = DEFAULT_AUTH_TOKEN_PATH) {
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 })

  const existingToken = readAuthToken(tokenPath)
  if (existingToken) {
    return existingToken
  }

  const token = randomBytes(32).toString('hex')
  try {
    writeFileSync(tokenPath, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return token
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err
    }

    const concurrentToken = readAuthToken(tokenPath)
    if (!concurrentToken) {
      throw new Error(`Could not read authentication token at ${tokenPath}`)
    }
    return concurrentToken
  }
}

export function createAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function isValidAuthHeader(header, expectedToken) {
  if (typeof header !== 'string' || !expectedToken) {
    return false
  }

  const provided = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${expectedToken}`)
  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(provided, expected)
}
