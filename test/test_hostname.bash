#!/usr/bin/env bash
#
# Tests for hostname.js - Callback host configuration
# Issue #6: Host discovery module
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing hostname.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_hostname_file_exists() {
  assert_file_exists "$PLUGIN_DIR/hostname.js"
}

test_hostname_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/hostname.js" 2>&1 || {
    echo "hostname.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_hostname_exports_get_callback_host() {
  grep -q "export.*function getCallbackHost\|export.*getCallbackHost" "$PLUGIN_DIR/hostname.js" || {
    echo "getCallbackHost export not found in hostname.js"
    return 1
  }
}

test_hostname_exports_discover_callback_host() {
  # Backwards compatibility alias
  grep -q "export.*discoverCallbackHost" "$PLUGIN_DIR/hostname.js" || {
    echo "discoverCallbackHost export not found in hostname.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_hostname_checks_env_var() {
  grep -q "NTFY_CALLBACK_HOST" "$PLUGIN_DIR/hostname.js" || {
    echo "NTFY_CALLBACK_HOST env var check not found in hostname.js"
    return 1
  }
}

test_hostname_delegates_to_config() {
  grep -q "import.*config.js\|from.*config" "$PLUGIN_DIR/hostname.js" || {
    echo "hostname.js should delegate to config.js"
    return 1
  }
}

test_hostname_uses_load_config() {
  grep -q "loadConfig" "$PLUGIN_DIR/hostname.js" || {
    echo "loadConfig usage not found in hostname.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_hostname_returns_env_var_when_set() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(NTFY_CALLBACK_HOST="test.example.com" node --experimental-vm-modules -e "
    import { getCallbackHost } from './plugin/hostname.js';
    
    const host = getCallbackHost();
    if (host !== 'test.example.com') {
      console.log('FAIL: Expected test.example.com, got ' + host);
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

test_hostname_returns_null_when_not_set_functional() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(unset NTFY_CALLBACK_HOST; node --experimental-vm-modules -e "
    // Clear the env var in case it's set
    delete process.env.NTFY_CALLBACK_HOST;
    
    import { getCallbackHost } from './plugin/hostname.js';
    
    const host = getCallbackHost();
    if (host !== null) {
      console.log('FAIL: Expected null, got ' + host);
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
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_hostname_file_exists \
  test_hostname_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_hostname_exports_get_callback_host \
  test_hostname_exports_discover_callback_host
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_hostname_checks_env_var \
  test_hostname_delegates_to_config \
  test_hostname_uses_load_config
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_hostname_returns_env_var_when_set \
  test_hostname_returns_null_when_not_set_functional
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
