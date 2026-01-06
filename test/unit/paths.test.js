/**
 * Tests for consistent path naming across the codebase.
 * 
 * These tests ensure all config paths use "opencode-pilot" 
 * and not the old "opencode-ntfy" name.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const SERVICE_DIR = join(ROOT_DIR, 'service');

describe('Path naming consistency', () => {
  
  describe('server.js', () => {
    const serverPath = join(SERVICE_DIR, 'server.js');
    const content = readFileSync(serverPath, 'utf8');
    
    test('uses opencode-pilot config path', () => {
      assert.match(content, /opencode-pilot.*config\.yaml|opencode-pilot/,
        'server.js should reference opencode-pilot paths');
    });
    
    test('does not reference old opencode-ntfy name', () => {
      assert.doesNotMatch(content, /opencode-ntfy/,
        'server.js should not reference old opencode-ntfy name');
    });
  });
  
  describe('plist file', () => {
    const plistPath = join(SERVICE_DIR, 'io.opencode.pilot.plist');
    const content = readFileSync(plistPath, 'utf8');
    
    test('uses opencode-pilot label', () => {
      assert.match(content, /io\.opencode\.pilot/,
        'plist should use io.opencode.pilot label');
    });
    
    test('does not reference old opencode-ntfy name', () => {
      assert.doesNotMatch(content, /opencode-ntfy/,
        'plist should not reference old opencode-ntfy name');
    });
  });
});
