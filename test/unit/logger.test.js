/**
 * Tests for plugin/logger.js - async debug logging
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('logger.js', () => {
  let tempDir;
  let logPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-logger-test-'));
    logPath = join(tempDir, 'debug.log');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('debug()', () => {
    test('writes log entry when enabled', async () => {
      // Fresh import to avoid module state from other tests
      const { initLogger, debug } = await import('../../plugin/logger.js');
      
      initLogger({ debug: true, debugPath: logPath });
      debug('test message');
      
      // Give async write time to complete (async I/O can take variable time)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      assert.ok(existsSync(logPath), 'Log file should exist');
      const content = readFileSync(logPath, 'utf8');
      assert.ok(content.includes('test message'), 'Log should contain message');
    });

    test('does not block - returns immediately', async () => {
      // Run in subprocess to get fresh module state and accurate timing
      const { execSync } = await import('child_process');
      const scriptPath = join(tempDir, 'benchmark.mjs');
      
      // Write benchmark script
      writeFileSync(scriptPath, `
import { appendFileSync } from 'fs';
import { initLogger, debug } from '${join(process.cwd(), 'plugin/logger.js').replace(/\\/g, '/')}';

const logPath = '${logPath.replace(/\\/g, '/')}';
const syncLogPath = '${join(tempDir, 'sync-baseline.log').replace(/\\/g, '/')}';

initLogger({ debug: true, debugPath: logPath });

// Measure sync baseline
const syncStart = Date.now();
for (let i = 0; i < 100; i++) {
  appendFileSync(syncLogPath, 'sync message ' + i + '\\n');
}
const syncElapsed = Date.now() - syncStart;

// Measure debug() calls
const start = Date.now();
for (let i = 0; i < 100; i++) {
  debug('message ' + i);
}
const elapsed = Date.now() - start;

console.log(JSON.stringify({ syncElapsed, elapsed }));
`);

      const result = execSync(`node ${scriptPath}`, { encoding: 'utf8' });
      const { syncElapsed, elapsed } = JSON.parse(result.trim());
      
      // debug() should be significantly faster than sync writes
      // If sync takes 30ms+, async should be <5ms (just queuing)
      assert.ok(
        elapsed < syncElapsed / 3,
        `debug() should be >3x faster than sync writes. Sync: ${syncElapsed}ms, debug(): ${elapsed}ms`
      );
      
      // Wait for async writes to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const content = readFileSync(logPath, 'utf8');
      assert.ok(content.includes('message 99'), 'All messages should eventually be written');
    });

    test('does nothing when disabled', async () => {
      const { initLogger, debug } = await import('../../plugin/logger.js');
      
      initLogger({ debug: false, debugPath: logPath });
      debug('should not appear');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      assert.ok(!existsSync(logPath), 'Log file should not exist when disabled');
    });

    test('includes data in log entry', async () => {
      const { initLogger, debug } = await import('../../plugin/logger.js');
      
      initLogger({ debug: true, debugPath: logPath });
      debug('event', { type: 'session.status', status: 'idle' });
      
      // Give async write time to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const content = readFileSync(logPath, 'utf8');
      assert.ok(content.includes('session.status'), 'Log should contain data');
      assert.ok(content.includes('idle'), 'Log should contain nested data');
    });
  });

  describe('initLogger()', () => {
    test('creates log directory if it does not exist', async () => {
      const { initLogger, debug } = await import('../../plugin/logger.js');
      
      const nestedPath = join(tempDir, 'nested', 'dir', 'debug.log');
      initLogger({ debug: true, debugPath: nestedPath });
      debug('test');
      
      // Give async write time to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      assert.ok(existsSync(nestedPath), 'Should create nested directories');
    });
  });
});
