// Shared version utility for opencode-pilot
//
// Returns the version from package.json

import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Get version from package.json
 * Checks multiple locations for compatibility with different install methods
 * @returns {string} Version string or 'unknown'
 */
export function getVersion() {
  const candidates = [
    join(__dirname, '..', 'package.json'),      // Development: service/../package.json
    join(__dirname, '..', '..', 'package.json'), // Homebrew: libexec/../package.json
  ]
  
  for (const packagePath of candidates) {
    try {
      if (existsSync(packagePath)) {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
        if (pkg.version) return pkg.version
      }
    } catch {
      // Try next candidate
    }
  }
  return 'unknown'
}
