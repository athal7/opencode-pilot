#!/usr/bin/env bash
#
# Tests for service/server.js - Standalone callback server as brew service
# Issue #13: Separate callback server as brew service
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing service/server.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_service_file_exists() {
  assert_file_exists "$SERVICE_DIR/server.js"
}

test_service_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/server.js" 2>&1 || {
    echo "server.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_service_exports_start_service() {
  grep -q "export.*function startService\|export.*startService" "$SERVICE_DIR/server.js" || {
    echo "startService export not found in server.js"
    return 1
  }
}

test_service_exports_stop_service() {
  grep -q "export.*function stopService\|export.*stopService" "$SERVICE_DIR/server.js" || {
    echo "stopService export not found in server.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_service_has_http_server() {
  grep -q "createServer\|http" "$SERVICE_DIR/server.js" || {
    echo "HTTP server not found in server.js"
    return 1
  }
}

test_service_has_unix_socket() {
  grep -q "createServer\|net\|\.sock\|socket" "$SERVICE_DIR/server.js" || {
    echo "Unix socket handling not found in server.js"
    return 1
  }
}

test_service_has_health_endpoint() {
  grep -q "/health" "$SERVICE_DIR/server.js" || {
    echo "/health endpoint not found in server.js"
    return 1
  }
}

test_service_has_callback_endpoint() {
  grep -q "/callback" "$SERVICE_DIR/server.js" || {
    echo "/callback endpoint not found in server.js"
    return 1
  }
}

test_service_handles_session_registration() {
  grep -q "register\|session" "$SERVICE_DIR/server.js" || {
    echo "Session registration not found in server.js"
    return 1
  }
}

test_service_handles_nonce_creation() {
  grep -q "createNonce\|nonce" "$SERVICE_DIR/server.js" || {
    echo "Nonce creation not found in server.js"
    return 1
  }
}

test_service_logs_with_prefix() {
  grep -q "\[opencode-ntfy\]" "$SERVICE_DIR/server.js" || {
    echo "Logging prefix [opencode-ntfy] not found in server.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_service_starts_and_stops() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    // Use random ports/sockets to avoid conflicts
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    
    if (!service.httpServer) {
      console.log('FAIL: HTTP server not started');
      process.exit(1);
    }
    
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

test_service_health_endpoint_returns_200() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/health');
    
    if (res.status !== 200) {
      console.log('FAIL: Health check returned ' + res.status);
      process.exit(1);
    }
    
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

test_service_returns_401_for_invalid_nonce() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/callback?nonce=invalid&response=once', {
      method: 'POST'
    });
    
    if (res.status !== 401) {
      console.log('FAIL: Expected 401, got ' + res.status);
      process.exit(1);
    }
    
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
  test_service_file_exists \
  test_service_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_service_exports_start_service \
  test_service_exports_stop_service
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_service_has_http_server \
  test_service_has_unix_socket \
  test_service_has_health_endpoint \
  test_service_has_callback_endpoint \
  test_service_handles_session_registration \
  test_service_handles_nonce_creation \
  test_service_logs_with_prefix
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_service_starts_and_stops \
  test_service_health_endpoint_returns_200 \
  test_service_returns_401_for_invalid_nonce
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
