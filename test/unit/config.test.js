/**
 * Tests for config.js - unified YAML configuration
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We'll test the module by creating temp config files

describe('config.js', () => {
  let tempDir;
  let configPath;
  let templatesDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-test-'));
    configPath = join(tempDir, 'config.yaml');
    templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    test('reads notifications from config.yaml', async () => {
      writeFileSync(configPath, `
notifications:
  topic: test-topic
  server: https://custom.ntfy.sh
  idle_delay_ms: 600000
`);

      const { loadConfig } = await import('../../plugin/config.js');
      const config = loadConfig(configPath);

      assert.strictEqual(config.topic, 'test-topic');
      assert.strictEqual(config.server, 'https://custom.ntfy.sh');
      assert.strictEqual(config.idleDelayMs, 600000);
    });

    test('returns defaults when config file missing', async () => {
      const { loadConfig } = await import('../../plugin/config.js');
      const config = loadConfig('/nonexistent/path/config.yaml');

      assert.strictEqual(config.server, 'https://ntfy.sh');
      assert.strictEqual(config.idleDelayMs, 300000);
    });

    test('handles all config options', async () => {
      writeFileSync(configPath, `
notifications:
  topic: my-topic
  server: https://ntfy.example.com
  token: tk_xxx
  idle_delay_ms: 600000
  idle_notify: false
  error_notify: false
  error_debounce_ms: 120000
  retry_notify_first: false
  retry_notify_after: 5
  debug: true
  debug_path: /custom/debug.log
`);

      const { loadConfig } = await import('../../plugin/config.js');
      const config = loadConfig(configPath);

      assert.strictEqual(config.topic, 'my-topic');
      assert.strictEqual(config.server, 'https://ntfy.example.com');
      assert.strictEqual(config.authToken, 'tk_xxx');
      assert.strictEqual(config.idleDelayMs, 600000);
      assert.strictEqual(config.idleNotify, false);
      assert.strictEqual(config.errorNotify, false);
      assert.strictEqual(config.errorDebounceMs, 120000);
      assert.strictEqual(config.retryNotifyFirst, false);
      assert.strictEqual(config.retryNotifyAfter, 5);
      assert.strictEqual(config.debug, true);
      assert.strictEqual(config.debugPath, '/custom/debug.log');
    });
  });
});
