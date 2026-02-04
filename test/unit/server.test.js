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
  });
});
