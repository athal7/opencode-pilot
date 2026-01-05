/**
 * Tests for consistent path naming across the codebase.
 * 
 * These tests ensure all config/socket paths use "opencode-pilot" 
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
const PLUGIN_DIR = join(ROOT_DIR, 'plugin');
const SERVICE_DIR = join(ROOT_DIR, 'service');

describe('Path naming consistency', () => {
  
  describe('config.js', () => {
    const configPath = join(PLUGIN_DIR, 'config.js');
    const content = readFileSync(configPath, 'utf8');
    
    test('uses opencode-pilot config path', () => {
      assert.match(content, /opencode-pilot.*config\.yaml/, 
        'config.js should reference opencode-pilot config path');
    });
    
    test('does not reference old opencode-ntfy path', () => {
      assert.doesNotMatch(content, /opencode-ntfy/,
        'config.js should not reference old opencode-ntfy name');
    });
  });
  
  describe('logger.js', () => {
    const loggerPath = join(PLUGIN_DIR, 'logger.js');
    const content = readFileSync(loggerPath, 'utf8');
    
    test('uses opencode-pilot debug log path', () => {
      assert.match(content, /opencode-pilot.*debug\.log/,
        'logger.js should reference opencode-pilot debug log path');
    });
    
    test('does not reference old opencode-ntfy path', () => {
      assert.doesNotMatch(content, /opencode-ntfy/,
        'logger.js should not reference old opencode-ntfy name');
    });
  });
  
  describe('service-client.js', () => {
    const clientPath = join(PLUGIN_DIR, 'service-client.js');
    const content = readFileSync(clientPath, 'utf8');
    
    test('uses opencode-pilot socket path', () => {
      assert.match(content, /opencode-pilot\.sock/,
        'service-client.js should reference opencode-pilot socket path');
    });
    
    test('does not reference old opencode-ntfy socket path', () => {
      assert.doesNotMatch(content, /opencode-ntfy\.sock/,
        'service-client.js should not reference old opencode-ntfy socket name');
    });
  });
  
  describe('server.js', () => {
    const serverPath = join(SERVICE_DIR, 'server.js');
    const content = readFileSync(serverPath, 'utf8');
    
    test('uses opencode-pilot socket path', () => {
      assert.match(content, /opencode-pilot\.sock/,
        'server.js should reference opencode-pilot socket path');
    });
    
    test('uses opencode-pilot config path', () => {
      assert.match(content, /opencode-pilot.*config\.json|opencode-pilot/,
        'server.js should reference opencode-pilot paths');
    });
  });
  
  describe('index.js (plugin entry)', () => {
    const indexPath = join(PLUGIN_DIR, 'index.js');
    const content = readFileSync(indexPath, 'utf8');
    
    test('does not reference old opencode-ntfy name in comments', () => {
      // Allow "ntfy" alone (the service name) but not "opencode-ntfy"
      assert.doesNotMatch(content, /opencode-ntfy/,
        'index.js should not reference old opencode-ntfy name');
    });
  });
});
