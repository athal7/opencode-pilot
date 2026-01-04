#!/usr/bin/env bash
#
# Tests for plugin/service-client.js - IPC client for plugin-to-service communication
# Issue #13: Separate callback server as brew service
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing service-client.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_service_client_file_exists() {
  assert_file_exists "$PLUGIN_DIR/service-client.js"
}

test_service_client_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/service-client.js" 2>&1 || {
    echo "service-client.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_service_client_exports_connect() {
  grep -q "export.*function connectToService\|export.*connectToService" "$PLUGIN_DIR/service-client.js" || {
    echo "connectToService export not found in service-client.js"
    return 1
  }
}

test_service_client_exports_disconnect() {
  grep -q "export.*function disconnectFromService\|export.*disconnectFromService" "$PLUGIN_DIR/service-client.js" || {
    echo "disconnectFromService export not found in service-client.js"
    return 1
  }
}

test_service_client_exports_request_nonce() {
  grep -q "export.*function requestNonce\|export.*requestNonce" "$PLUGIN_DIR/service-client.js" || {
    echo "requestNonce export not found in service-client.js"
    return 1
  }
}

test_service_client_exports_is_connected() {
  grep -q "export.*function isConnected\|export.*isConnected" "$PLUGIN_DIR/service-client.js" || {
    echo "isConnected export not found in service-client.js"
    return 1
  }
}

test_service_client_exports_try_reconnect() {
  grep -q "export.*function tryReconnect\|export.*tryReconnect" "$PLUGIN_DIR/service-client.js" || {
    echo "tryReconnect export not found in service-client.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_service_client_uses_net_module() {
  grep -q "net\|createConnection\|connect" "$PLUGIN_DIR/service-client.js" || {
    echo "net module usage not found in service-client.js"
    return 1
  }
}

test_service_client_has_socket_path() {
  grep -q "socket\|\.sock" "$PLUGIN_DIR/service-client.js" || {
    echo "Socket path handling not found in service-client.js"
    return 1
  }
}

test_service_client_handles_registration() {
  grep -q "register\|session" "$PLUGIN_DIR/service-client.js" || {
    echo "Session registration not found in service-client.js"
    return 1
  }
}

test_service_client_handles_nonce_request() {
  grep -q "create_nonce\|nonce" "$PLUGIN_DIR/service-client.js" || {
    echo "Nonce request handling not found in service-client.js"
    return 1
  }
}

test_service_client_handles_permission_response() {
  grep -q "permission_response\|onPermissionResponse" "$PLUGIN_DIR/service-client.js" || {
    echo "Permission response handling not found in service-client.js"
    return 1
  }
}

test_service_client_no_console_output() {
  # Should NOT have console output (silenced to avoid TUI interference)
  if grep -q "console\.\(error\|warn\|log\)" "$PLUGIN_DIR/service-client.js"; then
    echo "Console output found - should be silent to avoid TUI interference"
    return 1
  fi
}

test_service_client_handles_connection_errors() {
  grep -q "error\|ECONNREFUSED\|ENOENT" "$PLUGIN_DIR/service-client.js" || {
    echo "Connection error handling not found in service-client.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (requires Node.js and running service)
# =============================================================================

test_service_client_connects_to_service() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    import { connectToService, disconnectFromService, isConnected } from './plugin/service-client.js';
    
    // Start service with test socket
    const socketPath = '/tmp/opencode-ntfy-test-' + process.pid + '.sock';
    const service = await startService({ httpPort: 0, socketPath });
    
    // Connect client
    const connected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (!connected) {
      console.log('FAIL: Failed to connect to service');
      await stopService(service);
      process.exit(1);
    }
    
    if (!isConnected()) {
      console.log('FAIL: isConnected() returned false after connection');
      await stopService(service);
      process.exit(1);
    }
    
    await disconnectFromService();
    await stopService(service);
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_service_client_requests_nonce() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    import { connectToService, disconnectFromService, requestNonce } from './plugin/service-client.js';
    
    // Start service with test socket
    const socketPath = '/tmp/opencode-ntfy-test-' + process.pid + '.sock';
    const service = await startService({ httpPort: 0, socketPath });
    
    // Connect client
    await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    // Request nonce
    const nonce = await requestNonce('perm-123');
    
    if (!nonce || typeof nonce !== 'string') {
      console.log('FAIL: Did not receive valid nonce: ' + nonce);
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    await disconnectFromService();
    await stopService(service);
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_service_client_receives_permission_response() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    import { connectToService, disconnectFromService, requestNonce, setPermissionHandler } from './plugin/service-client.js';
    
    // Start service with test socket
    const socketPath = '/tmp/opencode-ntfy-test-' + process.pid + '.sock';
    const service = await startService({ httpPort: 0, socketPath });
    const port = service.httpServer.address().port;
    
    // Set up handler to receive response
    let receivedPermissionId, receivedResponse;
    setPermissionHandler((permissionId, response) => {
      receivedPermissionId = permissionId;
      receivedResponse = response;
    });
    
    // Connect client
    await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    // Request nonce
    const nonce = await requestNonce('perm-456');
    
    // Simulate callback from ntfy
    // Include X-Forwarded-Proto to bypass HTTPS redirect (simulates Tailscale Serve proxy)
    const res = await fetch('http://localhost:' + port + '/callback?nonce=' + nonce + '&response=once', {
      method: 'POST',
      headers: { 'X-Forwarded-Proto': 'https' }
    });
    
    if (res.status !== 200) {
      console.log('FAIL: Callback returned ' + res.status);
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    // Wait for handler to be called
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (receivedPermissionId !== 'perm-456') {
      console.log('FAIL: Wrong permissionId: ' + receivedPermissionId);
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    if (receivedResponse !== 'once') {
      console.log('FAIL: Wrong response: ' + receivedResponse);
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    await disconnectFromService();
    await stopService(service);
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_service_client_handles_service_not_running() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { connectToService, isConnected } from './plugin/service-client.js';
    
    // Try to connect to non-existent service
    const socketPath = '/tmp/opencode-ntfy-nonexistent-' + process.pid + '.sock';
    
    const connected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (connected) {
      console.log('FAIL: Should not have connected to non-existent service');
      process.exit(1);
    }
    
    if (isConnected()) {
      console.log('FAIL: isConnected() should return false');
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

# =============================================================================
# Reconnection Tests (Issue #41)
# =============================================================================

test_service_client_reconnects_when_service_starts_later() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    import { connectToService, disconnectFromService, isConnected, requestNonce, setPermissionHandler } from './plugin/service-client.js';
    
    const socketPath = '/tmp/opencode-ntfy-test-' + process.pid + '.sock';
    
    // First, try to connect when service is NOT running
    const connected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (connected) {
      console.log('FAIL: Should not connect when service not running');
      process.exit(1);
    }
    
    // Now start the service
    const service = await startService({ httpPort: 0, socketPath });
    
    // Reconnect should work now
    const reconnected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (!reconnected) {
      console.log('FAIL: Should reconnect when service starts');
      await stopService(service);
      process.exit(1);
    }
    
    if (!isConnected()) {
      console.log('FAIL: isConnected() should return true after reconnect');
      await stopService(service);
      process.exit(1);
    }
    
    // Verify we can request nonces after reconnect
    const nonce = await requestNonce('perm-reconnect');
    if (!nonce) {
      console.log('FAIL: Should be able to request nonce after reconnect');
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    await disconnectFromService();
    await stopService(service);
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_service_client_reconnects_after_service_restart() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    import { connectToService, disconnectFromService, isConnected, requestNonce } from './plugin/service-client.js';
    
    const socketPath = '/tmp/opencode-ntfy-test-' + process.pid + '.sock';
    
    // Start service and connect
    let service = await startService({ httpPort: 0, socketPath });
    
    const connected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (!connected) {
      console.log('FAIL: Initial connection failed');
      await stopService(service);
      process.exit(1);
    }
    
    // Verify connection works
    const nonce1 = await requestNonce('perm-1');
    if (!nonce1) {
      console.log('FAIL: First nonce request failed');
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    // Stop service (simulates service restart)
    await stopService(service);
    
    // Wait a bit for disconnect to be detected
    await new Promise(r => setTimeout(r, 100));
    
    if (isConnected()) {
      console.log('FAIL: isConnected() should be false after service stop');
      process.exit(1);
    }
    
    // Restart service
    service = await startService({ httpPort: 0, socketPath });
    
    // Reconnect
    const reconnected = await connectToService({
      sessionId: 'test-session',
      socketPath,
    });
    
    if (!reconnected) {
      console.log('FAIL: Reconnection after service restart failed');
      await stopService(service);
      process.exit(1);
    }
    
    // Verify we can request nonces after reconnect
    const nonce2 = await requestNonce('perm-2');
    if (!nonce2) {
      console.log('FAIL: Nonce request after reconnect failed');
      await disconnectFromService();
      await stopService(service);
      process.exit(1);
    }
    
    await disconnectFromService();
    await stopService(service);
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

# =============================================================================
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_service_client_file_exists \
  test_service_client_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_service_client_exports_connect \
  test_service_client_exports_disconnect \
  test_service_client_exports_request_nonce \
  test_service_client_exports_is_connected \
  test_service_client_exports_try_reconnect
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_service_client_uses_net_module \
  test_service_client_has_socket_path \
  test_service_client_handles_registration \
  test_service_client_handles_nonce_request \
  test_service_client_handles_permission_response \
  test_service_client_no_console_output \
  test_service_client_handles_connection_errors
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_service_client_connects_to_service \
  test_service_client_requests_nonce \
  test_service_client_receives_permission_response \
  test_service_client_handles_service_not_running
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Reconnection Tests (Issue #41):"

for test_func in \
  test_service_client_reconnects_when_service_starts_later \
  test_service_client_reconnects_after_service_restart
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
