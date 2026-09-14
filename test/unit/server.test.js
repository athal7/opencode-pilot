import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_AUTH_TOKEN = 'test-token';

function getExpectedVersion() {
  const packagePath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  return pkg.version;
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TEST_AUTH_TOKEN}`, ...extra };
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
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: authHeaders()
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/json');

      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(typeof data.version, 'string');
      assert.strictEqual(data.version, getExpectedVersion());
    });
  });

  describe('authentication', () => {
    test('rejects health requests without a bearer token', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.headers.get('www-authenticate'), 'Bearer');
    });

    test('rejects health requests with an invalid bearer token', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: 'Bearer invalid-token' }
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('CORS', () => {
    test('OPTIONS returns CORS headers without authentication', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    });

    test('OPTIONS includes all required headers', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/anything`, {
        method: 'OPTIONS'
      });

      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.strictEqual(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
      assert.ok(res.headers.get('access-control-allow-headers').includes('Content-Type'));
      assert.ok(res.headers.get('access-control-allow-headers').includes('Authorization'));
      assert.strictEqual(res.headers.get('access-control-max-age'), '86400');
    });
  });

  describe('unknown routes', () => {
    test('returns 404 for unknown paths', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/unknown`, {
        headers: authHeaders()
      });

      assert.strictEqual(res.status, 404);
    });

    test('returns 404 for POST to health', async () => {
      const { startService } = await import('../../service/server.js');

      service = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      const port = service.httpServer.address().port;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'POST',
        headers: authHeaders(),
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
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      assert.ok(localService.httpServer, 'Should have httpServer');
      assert.strictEqual(localService.httpServer.address().address, '127.0.0.1');
      assert.strictEqual(localService.pollingState, null, 'Should not have pollingState when disabled');

      const port = localService.httpServer.address().port;
      assert.ok(port > 0, 'Should have valid port');

      await stopService(localService);

      try {
        await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        assert.fail('Fetch should have failed after stop');
      } catch (err) {
        assert.ok(err.message.includes('fetch failed') || err.name === 'TimeoutError' || err.name === 'AbortError');
      }
    });

    test('handles stopService on already stopped service', async () => {
      const { startService, stopService } = await import('../../service/server.js');

      const localService = await startService({
        httpPort: 0,
        enablePolling: false,
        authToken: TEST_AUTH_TOKEN
      });

      await stopService(localService);
      await stopService(localService);
    });

    test('starts with enablePolling=false when no config exists', async () => {
      const { startService, stopService } = await import('../../service/server.js');

      const localService = await startService({
        httpPort: 0,
        enablePolling: true,
        reposConfig: '/nonexistent/config.yaml',
        authToken: TEST_AUTH_TOKEN
      });

      assert.ok(localService.httpServer);
      assert.strictEqual(localService.pollingState, null);

      await stopService(localService);
    });
  });
});
