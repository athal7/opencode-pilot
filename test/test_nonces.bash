#!/usr/bin/env bash
#
# Tests for nonces.js - Single-use nonces for callback authentication
# Replaces tokens.js (HMAC) with simpler, replay-resistant approach
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing nonces.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_nonces_file_exists() {
  assert_file_exists "$PLUGIN_DIR/nonces.js"
}

test_nonces_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/nonces.js" 2>&1 || {
    echo "nonces.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_nonces_exports_create_nonce() {
  grep -q "export.*function createNonce\|export.*createNonce" "$PLUGIN_DIR/nonces.js" || {
    echo "createNonce export not found in nonces.js"
    return 1
  }
}

test_nonces_exports_consume_nonce() {
  grep -q "export.*function consumeNonce\|export.*consumeNonce" "$PLUGIN_DIR/nonces.js" || {
    echo "consumeNonce export not found in nonces.js"
    return 1
  }
}

test_nonces_exports_cleanup() {
  grep -q "export.*function cleanup\|export.*cleanup" "$PLUGIN_DIR/nonces.js" || {
    echo "cleanup export not found in nonces.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_nonces_uses_crypto_random() {
  # Should use crypto.randomUUID() or similar for secure random nonces
  grep -q "randomUUID\|randomBytes" "$PLUGIN_DIR/nonces.js" || {
    echo "Secure random generation not found in nonces.js"
    return 1
  }
}

test_nonces_uses_map_for_storage() {
  # Should use Map for in-memory storage
  grep -q "Map\|map" "$PLUGIN_DIR/nonces.js" || {
    echo "Map storage not found in nonces.js"
    return 1
  }
}

test_nonces_stores_session_id() {
  grep -q "sessionId" "$PLUGIN_DIR/nonces.js" || {
    echo "sessionId not stored in nonces.js"
    return 1
  }
}

test_nonces_stores_permission_id() {
  grep -q "permissionId" "$PLUGIN_DIR/nonces.js" || {
    echo "permissionId not stored in nonces.js"
    return 1
  }
}

test_nonces_deletes_on_consume() {
  # Single-use: should delete nonce after consumption
  grep -q "delete\|\.delete(" "$PLUGIN_DIR/nonces.js" || {
    echo "Nonce deletion not found in nonces.js"
    return 1
  }
}

test_nonces_has_ttl() {
  # Should have a TTL for nonce expiry
  grep -q "TTL\|ttl\|expir\|createdAt" "$PLUGIN_DIR/nonces.js" || {
    echo "TTL/expiry not found in nonces.js"
    return 1
  }
}

test_consume_returns_null_for_invalid() {
  # consumeNonce should return null for invalid nonces
  grep -q "return null" "$PLUGIN_DIR/nonces.js" || {
    echo "null return for invalid nonce not found in nonces.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (Node.js required)
# =============================================================================

test_nonces_functional_create_and_consume() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { createNonce, consumeNonce } from './plugin/nonces.js';
    
    const nonce = createNonce('session-123', 'perm-456');
    if (!nonce || typeof nonce !== 'string') {
      console.log('FAIL: createNonce should return a string');
      process.exit(1);
    }
    
    const data = consumeNonce(nonce);
    if (!data) {
      console.log('FAIL: consumeNonce should return data for valid nonce');
      process.exit(1);
    }
    
    if (data.sessionId !== 'session-123' || data.permissionId !== 'perm-456') {
      console.log('FAIL: consumeNonce should return correct sessionId and permissionId');
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if [[ "$result" != "PASS" ]]; then
    echo "$result"
    return 1
  fi
}

test_nonces_functional_single_use() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { createNonce, consumeNonce } from './plugin/nonces.js';
    
    const nonce = createNonce('session-123', 'perm-456');
    
    // First consume should succeed
    const first = consumeNonce(nonce);
    if (!first) {
      console.log('FAIL: first consumeNonce should succeed');
      process.exit(1);
    }
    
    // Second consume should fail (single-use)
    const second = consumeNonce(nonce);
    if (second !== null) {
      console.log('FAIL: second consumeNonce should return null (single-use)');
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if [[ "$result" != "PASS" ]]; then
    echo "$result"
    return 1
  fi
}

test_nonces_functional_invalid_nonce() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { consumeNonce } from './plugin/nonces.js';
    
    const result = consumeNonce('nonexistent-nonce');
    if (result !== null) {
      console.log('FAIL: consumeNonce should return null for invalid nonce');
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1) || {
    echo "Functional test failed: $result"
    return 1
  }
  
  if [[ "$result" != "PASS" ]]; then
    echo "$result"
    return 1
  fi
}

# =============================================================================
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_nonces_file_exists \
  test_nonces_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_nonces_exports_create_nonce \
  test_nonces_exports_consume_nonce \
  test_nonces_exports_cleanup
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_nonces_uses_crypto_random \
  test_nonces_uses_map_for_storage \
  test_nonces_stores_session_id \
  test_nonces_stores_permission_id \
  test_nonces_deletes_on_consume \
  test_nonces_has_ttl \
  test_consume_returns_null_for_invalid
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_nonces_functional_create_and_consume \
  test_nonces_functional_single_use \
  test_nonces_functional_invalid_nonce
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
