#!/usr/bin/env bash
#
# Tests for config.js - Configuration management
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing config.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_config_file_exists() {
  assert_file_exists "$PLUGIN_DIR/config.js"
}

test_config_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/config.js" 2>&1 || {
    echo "config.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_config_exports_load_config() {
  grep -q "export.*function loadConfig\|export.*loadConfig" "$PLUGIN_DIR/config.js" || {
    echo "loadConfig export not found in config.js"
    return 1
  }
}

test_config_exports_get_callback_host() {
  grep -q "export.*function getCallbackHost\|export.*getCallbackHost" "$PLUGIN_DIR/config.js" || {
    echo "getCallbackHost export not found in config.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_config_reads_file() {
  grep -q "readFileSync\|existsSync" "$PLUGIN_DIR/config.js" || {
    echo "File reading not found in config.js"
    return 1
  }
}

test_config_uses_separate_config_file() {
  grep -q "opencode-ntfy.*config.json\|CONFIG_PATH" "$PLUGIN_DIR/config.js" || {
    echo "Separate config file path not found in config.js"
    return 1
  }
}

test_config_parses_json() {
  grep -q "JSON.parse" "$PLUGIN_DIR/config.js" || {
    echo "JSON parsing not found in config.js"
    return 1
  }
}

test_config_supports_env_vars() {
  grep -q "process.env" "$PLUGIN_DIR/config.js" || {
    echo "Environment variable support not found in config.js"
    return 1
  }
}

test_config_has_all_fields() {
  local required_fields=(
    "topic"
    "server"
    "authToken"
    "callbackHost"
    "callbackPort"
    "idleDelayMs"
    "errorNotify"
    "errorDebounceMs"
    "retryNotifyFirst"
    "retryNotifyAfter"
    "debug"
    "debugPath"
  )
  
  for field in "${required_fields[@]}"; do
    if ! grep -q "$field" "$PLUGIN_DIR/config.js"; then
      echo "Config field '$field' not found in config.js"
      return 1
    fi
  done
  return 0
}

test_config_has_defaults() {
  # Check for default values
  grep -q "https://ntfy.sh" "$PLUGIN_DIR/config.js" || {
    echo "Default server not found in config.js"
    return 1
  }
  grep -q "4097" "$PLUGIN_DIR/config.js" || {
    echo "Default port not found in config.js"
    return 1
  }
  grep -q "300000" "$PLUGIN_DIR/config.js" || {
    echo "Default idle delay not found in config.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_config_load_returns_defaults() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(unset NTFY_TOPIC NTFY_SERVER NTFY_TOKEN; node --experimental-vm-modules -e "
    // Clear env vars
    delete process.env.NTFY_TOPIC;
    delete process.env.NTFY_SERVER;
    delete process.env.NTFY_TOKEN;
    
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.server !== 'https://ntfy.sh') {
      console.log('FAIL: Expected default server https://ntfy.sh, got ' + config.server);
      process.exit(1);
    }
    if (config.callbackPort !== 4097) {
      console.log('FAIL: Expected default port 4097, got ' + config.callbackPort);
      process.exit(1);
    }
    if (config.idleDelayMs !== 300000) {
      console.log('FAIL: Expected default idle delay 300000, got ' + config.idleDelayMs);
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

test_config_env_overrides_defaults() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(NTFY_TOPIC="my-topic" NTFY_SERVER="https://custom.ntfy.sh" node --experimental-vm-modules -e "
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.topic !== 'my-topic') {
      console.log('FAIL: Expected topic my-topic, got ' + config.topic);
      process.exit(1);
    }
    if (config.server !== 'https://custom.ntfy.sh') {
      console.log('FAIL: Expected server https://custom.ntfy.sh, got ' + config.server);
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

test_config_get_callback_host_from_config() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { getCallbackHost } from './plugin/config.js';
    
    const config = { callbackHost: 'myhost.ts.net' };
    const host = getCallbackHost(config);
    
    if (host !== 'myhost.ts.net') {
      console.log('FAIL: Expected myhost.ts.net, got ' + host);
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

test_config_get_callback_host_returns_null_when_not_configured() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { getCallbackHost } from './plugin/config.js';
    
    const config = { callbackHost: null };
    const host = getCallbackHost(config);
    
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

test_config_debug_defaults_to_false() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    // Clear debug env var
    delete process.env.NTFY_DEBUG;
    
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.debug !== false) {
      console.log('FAIL: Expected debug to default to false, got ' + config.debug);
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

test_config_debug_env_override() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(NTFY_DEBUG=true node --experimental-vm-modules -e "
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.debug !== true) {
      console.log('FAIL: Expected debug to be true from env, got ' + config.debug);
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

test_config_debug_path_defaults_to_null() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    // Clear debug path env var
    delete process.env.NTFY_DEBUG_PATH;
    
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.debugPath !== null) {
      console.log('FAIL: Expected debugPath to default to null, got ' + config.debugPath);
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

test_config_debug_path_env_override() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(NTFY_DEBUG_PATH="/custom/debug.log" node --experimental-vm-modules -e "
    import { loadConfig } from './plugin/config.js';
    
    const config = loadConfig();
    
    if (config.debugPath !== '/custom/debug.log') {
      console.log('FAIL: Expected debugPath to be /custom/debug.log, got ' + config.debugPath);
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
  test_config_file_exists \
  test_config_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_config_exports_load_config \
  test_config_exports_get_callback_host
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_config_reads_file \
  test_config_uses_separate_config_file \
  test_config_parses_json \
  test_config_supports_env_vars \
  test_config_has_all_fields \
  test_config_has_defaults
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_config_load_returns_defaults \
  test_config_env_overrides_defaults \
  test_config_get_callback_host_from_config \
  test_config_get_callback_host_returns_null_when_not_configured \
  test_config_debug_defaults_to_false \
  test_config_debug_env_override \
  test_config_debug_path_defaults_to_null \
  test_config_debug_path_env_override
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
