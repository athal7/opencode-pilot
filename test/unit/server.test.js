/**
 * Tests for service/server.js - HTTP server and health endpoint
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get expected version from package.json
function getExpectedVersion() {
  const packagePath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  return pkg.version;
}

describe('service/server.js', () => {
  let service = null;

  afterEach(async () => {
    if (service) {
      const { stopService } = await import('../../service/server.js');
      await stopService(service);
      service = null;
    }
  });

  describe('health endpoint', () => {
    test('returns JSON with status and version', async () => {
      const { startService, stopService } = await import('../../service/server.js');
      
      // Start service on random port
      service = await startService({ 
        httpPort: 0,  // Let OS assign port
        enablePolling: false 
      });
      
      const port = service.httpServer.address().port;
      const res = await fetch(`http://localhost:${port}/health`);
      
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/json');
      
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(typeof data.version, 'string');
      assert.strictEqual(data.version, getExpectedVersion());
    });

  });

  describe('CORS', () => {
    test('OPTIONS returns CORS headers', async () => {
      const { startService } = await import('../../service/server.js');
      
      service = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      const port = service.httpServer.address().port;
      const res = await fetch(`http://localhost:${port}/health`, {
        method: 'OPTIONS'
      });
      
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    });
  });

  describe('unknown routes', () => {
    test('returns 404 for unknown paths', async () => {
      const { startService } = await import('../../service/server.js');
      
      service = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      const port = service.httpServer.address().port;
      const res = await fetch(`http://localhost:${port}/unknown`);
      
      assert.strictEqual(res.status, 404);
    });

    test('returns 404 for POST to health', async () => {
      const { startService } = await import('../../service/server.js');
      
      service = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      const port = service.httpServer.address().port;
      const res = await fetch(`http://localhost:${port}/health`, {
        method: 'POST',
        body: '{}'
      });
      
      assert.strictEqual(res.status, 404);
    });
  });

  describe('startService and stopService', () => {
    test('starts and stops cleanly', async () => {
      const { startService, stopService } = await import('../../service/server.js');
      
      const localService = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      assert.ok(localService.httpServer, 'Should have httpServer');
      assert.strictEqual(localService.pollingState, null, 'Should not have pollingState when disabled');
      
      const port = localService.httpServer.address().port;
      assert.ok(port > 0, 'Should have valid port');
      
      await stopService(localService);
      
      // Server should be closed - attempting to fetch should fail
      try {
        await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
        assert.fail('Fetch should have failed after stop');
      } catch (err) {
        // Expected - connection refused or timeout
        assert.ok(err.message.includes('fetch failed') || err.name === 'TimeoutError' || err.name === 'AbortError');
      }
    });

    test('handles stopService on already stopped service', async () => {
      const { startService, stopService } = await import('../../service/server.js');
      
      const localService = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      // Stop twice - should not throw
      await stopService(localService);
      await stopService(localService);
    });

    test('starts with enablePolling=false when no config exists', async () => {
      const { startService, stopService } = await import('../../service/server.js');
      
      const localService = await startService({ 
        httpPort: 0,
        enablePolling: true, // enabled but config doesn't exist
        reposConfig: '/nonexistent/config.yaml'
      });
      
      // Should start without polling since config doesn't exist
      assert.ok(localService.httpServer);
      assert.strictEqual(localService.pollingState, null);
      
      await stopService(localService);
    });
  });

  describe('CORS headers', () => {
    test('OPTIONS includes all required headers', async () => {
      const { startService } = await import('../../service/server.js');
      
      service = await startService({ 
        httpPort: 0,
        enablePolling: false 
      });
      
      const port = service.httpServer.address().port;
      const res = await fetch(`http://localhost:${port}/anything`, {
        method: 'OPTIONS'
      });
      
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.strictEqual(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
      assert.ok(res.headers.get('access-control-allow-headers').includes('Content-Type'));
      assert.strictEqual(res.headers.get('access-control-max-age'), '86400');
    });
  });
});
