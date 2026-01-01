#!/usr/bin/env bash
#
# Tests for callback.js - HTTP callback server for permission responses
# Issue #4: Callback server module
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing callback.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_callback_file_exists() {
  assert_file_exists "$PLUGIN_DIR/callback.js"
}

test_callback_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/callback.js" 2>&1 || {
    echo "callback.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_callback_exports_start_callback_server() {
  grep -q "export.*function startCallbackServer\|export.*startCallbackServer" "$PLUGIN_DIR/callback.js" || {
    echo "startCallbackServer export not found in callback.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_callback_uses_http_module() {
  grep -q "createServer\|http" "$PLUGIN_DIR/callback.js" || {
    echo "HTTP server creation not found in callback.js"
    return 1
  }
}

test_callback_has_health_endpoint() {
  grep -q "/health\|health" "$PLUGIN_DIR/callback.js" || {
    echo "/health endpoint not found in callback.js"
    return 1
  }
}

test_callback_has_callback_endpoint() {
  grep -q "/callback" "$PLUGIN_DIR/callback.js" || {
    echo "/callback endpoint not found in callback.js"
    return 1
  }
}

test_callback_uses_nonces() {
  grep -q "consumeNonce\|nonce" "$PLUGIN_DIR/callback.js" || {
    echo "Nonce handling not found in callback.js"
    return 1
  }
}

test_callback_handles_once_response() {
  grep -q "once" "$PLUGIN_DIR/callback.js" || {
    echo "'once' response handling not found in callback.js"
    return 1
  }
}

test_callback_handles_always_response() {
  grep -q "always" "$PLUGIN_DIR/callback.js" || {
    echo "'always' response handling not found in callback.js"
    return 1
  }
}

test_callback_handles_reject_response() {
  grep -q "reject" "$PLUGIN_DIR/callback.js" || {
    echo "'reject' response handling not found in callback.js"
    return 1
  }
}

test_callback_returns_401_for_invalid_nonce() {
  grep -q "401" "$PLUGIN_DIR/callback.js" || {
    echo "401 response for invalid nonce not found in callback.js"
    return 1
  }
}

test_callback_returns_400_for_invalid_response() {
  grep -q "400" "$PLUGIN_DIR/callback.js" || {
    echo "400 response for invalid response not found in callback.js"
    return 1
  }
}

test_callback_returns_404_for_unknown_routes() {
  grep -q "404" "$PLUGIN_DIR/callback.js" || {
    echo "404 response for unknown routes not found in callback.js"
    return 1
  }
}

test_callback_logs_startup() {
  grep -q "console.log.*listen\|listening\|started\|Callback server" "$PLUGIN_DIR/callback.js" || {
    echo "Startup logging not found in callback.js"
    return 1
  }
}

test_callback_not_implemented_removed() {
  if grep -q "throw new Error.*Not implemented" "$PLUGIN_DIR/callback.js"; then
    echo "callback.js still has 'Not implemented' placeholder"
    return 1
  fi
  return 0
}

# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_callback_server_starts_and_stops() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    
    const server = startCallbackServer(0, () => {}); // Port 0 = random available port
    
    // Get the assigned port
    const port = server.address().port;
    if (!port || port <= 0) {
      console.log('FAIL: Server did not start on a valid port');
      process.exit(1);
    }
    
    // Stop the server
    server.close(() => {
      console.log('PASS');
      process.exit(0);
    });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if [[ "$result" != "PASS" ]]; then
    echo "$result"
    return 1
  fi
}

test_callback_health_endpoint_returns_200() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    
    const server = startCallbackServer(0, () => {});
    const port = server.address().port;
    
    // Make health check request
    fetch(\`http://localhost:\${port}/health\`)
      .then(res => {
        if (res.status !== 200) {
          console.log('FAIL: Health check returned ' + res.status);
          process.exit(1);
        }
        return res.text();
      })
      .then(body => {
        server.close(() => {
          console.log('PASS');
          process.exit(0);
        });
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_callback_returns_401_for_invalid_nonce_functional() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    
    const server = startCallbackServer(0, () => {});
    const port = server.address().port;
    
    // Make callback request with invalid nonce
    fetch(\`http://localhost:\${port}/callback?nonce=invalid&response=once\`, { method: 'POST' })
      .then(res => {
        if (res.status !== 401) {
          console.log('FAIL: Expected 401 for invalid nonce, got ' + res.status);
          process.exit(1);
        }
        server.close(() => {
          console.log('PASS');
          process.exit(0);
        });
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_callback_returns_400_for_invalid_response_functional() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    import { createNonce } from './plugin/nonces.js';
    
    const server = startCallbackServer(0, () => {});
    const port = server.address().port;
    
    // Create a valid nonce
    const nonce = createNonce('session-123', 'perm-456');
    
    // Make callback request with invalid response value
    fetch(\`http://localhost:\${port}/callback?nonce=\${nonce}&response=invalid\`, { method: 'POST' })
      .then(res => {
        if (res.status !== 400) {
          console.log('FAIL: Expected 400 for invalid response, got ' + res.status);
          process.exit(1);
        }
        server.close(() => {
          console.log('PASS');
          process.exit(0);
        });
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_callback_invokes_handler_with_correct_args() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    import { createNonce } from './plugin/nonces.js';
    
    let handlerCalled = false;
    let receivedSessionId, receivedPermissionId, receivedResponse;
    
    const handler = (sessionId, permissionId, response) => {
      handlerCalled = true;
      receivedSessionId = sessionId;
      receivedPermissionId = permissionId;
      receivedResponse = response;
    };
    
    const server = startCallbackServer(0, handler);
    const port = server.address().port;
    
    // Create a valid nonce
    const nonce = createNonce('session-123', 'perm-456');
    
    // Make callback request
    fetch(\`http://localhost:\${port}/callback?nonce=\${nonce}&response=once\`, { method: 'POST' })
      .then(res => {
        if (res.status !== 200) {
          console.log('FAIL: Expected 200, got ' + res.status);
          process.exit(1);
        }
        
        // Give handler time to execute
        setTimeout(() => {
          if (!handlerCalled) {
            console.log('FAIL: Handler was not called');
            process.exit(1);
          }
          if (receivedSessionId !== 'session-123') {
            console.log('FAIL: Wrong sessionId: ' + receivedSessionId);
            process.exit(1);
          }
          if (receivedPermissionId !== 'perm-456') {
            console.log('FAIL: Wrong permissionId: ' + receivedPermissionId);
            process.exit(1);
          }
          if (receivedResponse !== 'once') {
            console.log('FAIL: Wrong response: ' + receivedResponse);
            process.exit(1);
          }
          
          server.close(() => {
            console.log('PASS');
            process.exit(0);
          });
        }, 100);
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_callback_returns_400_for_missing_params_functional() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    
    const server = startCallbackServer(0, () => {});
    const port = server.address().port;
    
    // Make callback request without nonce param
    fetch(\`http://localhost:\${port}/callback?response=once\`, { method: 'POST' })
      .then(res => {
        if (res.status !== 400) {
          console.log('FAIL: Expected 400 for missing nonce, got ' + res.status);
          process.exit(1);
        }
        // Also test missing response param
        return fetch(\`http://localhost:\${port}/callback?nonce=test\`, { method: 'POST' });
      })
      .then(res => {
        if (res.status !== 400) {
          console.log('FAIL: Expected 400 for missing response, got ' + res.status);
          process.exit(1);
        }
        server.close(() => {
          console.log('PASS');
          process.exit(0);
        });
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_callback_returns_404_for_unknown_route_functional() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startCallbackServer } from './plugin/callback.js';
    
    const server = startCallbackServer(0, () => {});
    const port = server.address().port;
    
    // Make request to unknown route
    fetch(\`http://localhost:\${port}/unknown\`)
      .then(res => {
        if (res.status !== 404) {
          console.log('FAIL: Expected 404 for unknown route, got ' + res.status);
          process.exit(1);
        }
        server.close(() => {
          console.log('PASS');
          process.exit(0);
        });
      })
      .catch(err => {
        console.log('FAIL: ' + err.message);
        process.exit(1);
      });
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
  test_callback_file_exists \
  test_callback_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_callback_exports_start_callback_server
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_callback_uses_http_module \
  test_callback_has_health_endpoint \
  test_callback_has_callback_endpoint \
  test_callback_uses_nonces \
  test_callback_handles_once_response \
  test_callback_handles_always_response \
  test_callback_handles_reject_response \
  test_callback_returns_401_for_invalid_nonce \
  test_callback_returns_400_for_invalid_response \
  test_callback_returns_404_for_unknown_routes \
  test_callback_logs_startup \
  test_callback_not_implemented_removed
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_callback_server_starts_and_stops \
  test_callback_health_endpoint_returns_200 \
  test_callback_returns_401_for_invalid_nonce_functional \
  test_callback_returns_400_for_invalid_response_functional \
  test_callback_returns_400_for_missing_params_functional \
  test_callback_invokes_handler_with_correct_args \
  test_callback_returns_404_for_unknown_route_functional
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
