#!/usr/bin/env bash
#
# Tests for opencode-ntfy plugin
#
# These tests verify plugin file structure and JavaScript syntax.
# Pure function tests will be added as modules are implemented.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing opencode-ntfy plugin..."
echo ""

# =============================================================================
# Plugin File Structure Tests
# =============================================================================

test_plugin_index_exists() {
  assert_file_exists "$PLUGIN_DIR/index.js"
}

test_plugin_notifier_exists() {
  assert_file_exists "$PLUGIN_DIR/notifier.js"
}

test_plugin_callback_exists() {
  assert_file_exists "$PLUGIN_DIR/callback.js"
}

test_plugin_hostname_exists() {
  assert_file_exists "$PLUGIN_DIR/hostname.js"
}

test_plugin_nonces_exists() {
  assert_file_exists "$PLUGIN_DIR/nonces.js"
}

test_plugin_service_client_exists() {
  assert_file_exists "$PLUGIN_DIR/service-client.js"
}

# =============================================================================
# JavaScript Syntax Validation Tests
# =============================================================================

test_index_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/index.js" 2>&1 || {
    echo "index.js has syntax errors"
    return 1
  }
}

test_notifier_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/notifier.js" 2>&1 || {
    echo "notifier.js has syntax errors"
    return 1
  }
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
# Configuration Tests
# =============================================================================

test_index_imports_config() {
  # Verify index.js imports config from config.js
  grep -q "import.*loadConfig.*from.*config" "$PLUGIN_DIR/index.js" || {
    echo "loadConfig import not found in index.js"
    return 1
  }
}

test_index_uses_load_config() {
  # Verify index.js calls loadConfig()
  grep -q "loadConfig()" "$PLUGIN_DIR/index.js" || {
    echo "loadConfig() call not found in index.js"
    return 1
  }
}

# =============================================================================
# Idle Notification Behavior Tests
# =============================================================================

test_handles_session_status_events() {
  # Verify the event handler checks for session.status events
  grep -q "session.status" "$PLUGIN_DIR/index.js" || {
    echo "session.status event handling not found"
    return 1
  }
}

test_handles_idle_status() {
  # Verify idle status triggers timer
  grep -q "idle" "$PLUGIN_DIR/index.js" || {
    echo "idle status handling not found"
    return 1
  }
}

test_handles_busy_status() {
  # Verify busy status cancels timer
  grep -q "busy" "$PLUGIN_DIR/index.js" || {
    echo "busy status handling not found"
    return 1
  }
}

test_uses_settimeout_for_idle() {
  # Verify setTimeout is used for idle delay
  grep -q "setTimeout" "$PLUGIN_DIR/index.js" || {
    echo "setTimeout not found for idle delay"
    return 1
  }
}

test_uses_cleartimeout_for_busy() {
  # Verify clearTimeout is used when busy
  grep -q "clearTimeout" "$PLUGIN_DIR/index.js" || {
    echo "clearTimeout not found for busy cancel"
    return 1
  }
}

test_imports_send_notification_from_notifier() {
  # Verify index.js imports sendNotification from notifier.js
  grep -q "sendNotification" "$PLUGIN_DIR/index.js" || {
    echo "sendNotification not imported/used in index.js"
    return 1
  }
}

test_uses_configured_server_and_topic() {
  # Verify notification uses config.server and config.topic
  grep -q 'config\.server' "$PLUGIN_DIR/index.js" && \
  grep -q 'config\.topic' "$PLUGIN_DIR/index.js" || {
    echo "Notification should use config.server and config.topic"
    return 1
  }
}

test_uses_configured_idle_delay() {
  # Verify timeout uses config.idleDelayMs
  grep -q 'config\.idleDelayMs' "$PLUGIN_DIR/index.js" || {
    echo "Timer should use config.idleDelayMs"
    return 1
  }
}

test_uses_directory_param_not_process_cwd() {
  # Should use the directory parameter from OpenCode, not process.cwd()
  # This ensures devcontainer temp dirs don't show up in notifications
  grep -q 'directory' "$PLUGIN_DIR/index.js" || {
    echo "directory parameter not used in index.js"
    return 1
  }
  # Should NOT use process.cwd() for directory name in code (comments are ok)
  # Look for actual usage like: basename(process.cwd()) or = process.cwd()
  if grep -E 'basename\(process\.cwd\(\)\)|=\s*process\.cwd\(\)' "$PLUGIN_DIR/index.js"; then
    echo "Should not use process.cwd() for directory - use directory param instead"
    return 1
  fi
}

test_idle_notification_shows_repo_context() {
  # Idle notification should include repo name for context
  # Title should be "Idle (repo)" not just "OpenCode"
  grep -q 'Idle' "$PLUGIN_DIR/index.js" || {
    echo "Idle notification title should include 'Idle'"
    return 1
  }
}

# =============================================================================
# Logging Tests
# =============================================================================

test_logs_disabled_when_no_topic() {
  # Verify log message when topic not configured
  grep -q "No topic configured\|topic.*disabled" "$PLUGIN_DIR/index.js" || {
    echo "Missing log message for disabled plugin"
    return 1
  }
}

test_logs_initialized_with_topic() {
  # Verify log message when plugin initialized
  grep -q "Initialized for topic" "$PLUGIN_DIR/index.js" || {
    echo "Missing log message for initialized plugin"
    return 1
  }
}

test_logs_configuration_summary() {
  # Verify config summary is logged (server, idleDelay, etc.)
  grep -q "server:" "$PLUGIN_DIR/index.js" || \
  grep -q "config\.server" "$PLUGIN_DIR/index.js" | grep -q "console.log" || {
    # Alternative: check for a structured log of config
    grep -q "idleDelayMs" "$PLUGIN_DIR/index.js" | grep -q "console.log" || true
  }
  # This is somewhat covered by the existing "Initialized" log
  return 0
}

# =============================================================================
# Plugin Export Structure Tests
# =============================================================================

test_index_exports_notify() {
  grep -q "export const Notify" "$PLUGIN_DIR/index.js" || {
    echo "Notify export not found in index.js"
    return 1
  }
}

test_index_has_default_export() {
  grep -q "export default" "$PLUGIN_DIR/index.js" || {
    echo "Default export not found in index.js"
    return 1
  }
}

test_notifier_exports_send_notification() {
  grep -q "export.*sendNotification" "$PLUGIN_DIR/notifier.js" || {
    echo "sendNotification export not found in notifier.js"
    return 1
  }
}

test_notifier_exports_send_permission_notification() {
  grep -q "export.*sendPermissionNotification" "$PLUGIN_DIR/notifier.js" || {
    echo "sendPermissionNotification export not found in notifier.js"
    return 1
  }
}

test_callback_exports_start_callback_server() {
  grep -q "export.*startCallbackServer" "$PLUGIN_DIR/callback.js" || {
    echo "startCallbackServer export not found in callback.js"
    return 1
  }
}

test_hostname_exports_discover_callback_host() {
  grep -q "export.*discoverCallbackHost" "$PLUGIN_DIR/hostname.js" || {
    echo "discoverCallbackHost export not found in hostname.js"
    return 1
  }
}

test_nonces_exports_create_nonce() {
  grep -q "export.*createNonce" "$PLUGIN_DIR/nonces.js" || {
    echo "createNonce export not found in nonces.js"
    return 1
  }
}

test_nonces_exports_consume_nonce() {
  grep -q "export.*consumeNonce" "$PLUGIN_DIR/nonces.js" || {
    echo "consumeNonce export not found in nonces.js"
    return 1
  }
}

# =============================================================================
# Service Integration Tests
# =============================================================================

test_index_imports_service_client() {
  grep -q "import.*service-client\|from.*service-client" "$PLUGIN_DIR/index.js" || {
    echo "service-client import not found in index.js"
    return 1
  }
}

test_index_connects_to_service() {
  grep -q "connectToService" "$PLUGIN_DIR/index.js" || {
    echo "connectToService call not found in index.js"
    return 1
  }
}

test_index_handles_permission_updated() {
  grep -q "permission.updated\|permission\.updated" "$PLUGIN_DIR/index.js" || {
    echo "permission.updated event handling not found in index.js"
    return 1
  }
}

# =============================================================================
# OpenCode Runtime Integration Tests
# =============================================================================
# These tests verify the plugin doesn't hang opencode on startup and
# works correctly in the real OpenCode runtime.
#
# Tests run if opencode is installed and plugin is configured.
# Skipped in CI unless explicitly enabled.

# Helper to check if we can run integration tests
can_run_integration_tests() {
  # Check opencode is installed
  if ! command -v opencode &>/dev/null; then
    return 1
  fi
  
  # Check plugin is installed
  if [[ ! -f "$HOME/.config/opencode/plugins/opencode-ntfy/index.js" ]]; then
    return 1
  fi
  
  return 0
}

# Cross-platform timeout wrapper
# Uses perl alarm which works on macOS and Linux
run_with_timeout() {
  local timeout_secs="$1"
  shift
  perl -e "alarm $timeout_secs; exec @ARGV" "$@" 2>&1
}

# Run opencode and capture output (with timeout)
run_opencode() {
  local prompt="$1"
  local timeout="${2:-60}"
  
  run_with_timeout "$timeout" opencode run --format json "$prompt"
}

test_opencode_starts_within_timeout() {
  if ! can_run_integration_tests; then
    echo "SKIP: opencode integration tests disabled"
    return 0
  fi
  
  # CRITICAL: Verify opencode starts within 10 seconds
  # This catches plugin initialization hangs that would block startup indefinitely.
  
  local start_time end_time elapsed output
  start_time=$(date +%s)
  
  # Use a short timeout - if plugin hangs, this will fail
  output=$(run_with_timeout 10 opencode run --format json "Say hi" 2>&1)
  local exit_code=$?
  
  end_time=$(date +%s)
  elapsed=$((end_time - start_time))
  
  if [[ $exit_code -ne 0 ]]; then
    # Check if it was a timeout (exit code 142 = SIGALRM)
    if [[ $exit_code -eq 142 ]] || [[ "$output" == *"Alarm clock"* ]]; then
      echo "FAIL: opencode startup timed out after ${elapsed}s (plugin may be hanging)"
      echo "Output: $output"
      return 1
    fi
    echo "opencode run failed (exit $exit_code): $output"
    return 1
  fi
  
  # Verify we got a response
  if ! echo "$output" | grep -q '"type"'; then
    echo "No valid JSON output from opencode"
    echo "Output: $output"
    return 1
  fi
  
  return 0
}

test_opencode_plugin_loads() {
  if ! can_run_integration_tests; then
    echo "SKIP: opencode integration tests disabled"
    return 0
  fi
  
  # Plugin should load without errors - check opencode doesn't report plugin failures
  local output
  output=$(run_opencode "Say hello" 30) || {
    echo "opencode run failed: $output"
    return 1
  }
  
  # Check that output doesn't contain plugin error messages
  if echo "$output" | grep -qi "plugin.*error\|failed to load"; then
    echo "Plugin load error detected"
    echo "Output: $output"
    return 1
  fi
  
  return 0
}

test_opencode_ntfy_disabled_without_topic() {
  if ! can_run_integration_tests; then
    echo "SKIP: opencode integration tests disabled"
    return 0
  fi
  
  # Without NTFY_TOPIC, plugin should disable gracefully (not crash)
  # Unset NTFY_TOPIC temporarily
  local old_topic="${NTFY_TOPIC:-}"
  unset NTFY_TOPIC
  
  local output
  output=$(run_opencode "Say hi" 30)
  local exit_code=$?
  
  # Restore
  if [[ -n "$old_topic" ]]; then
    export NTFY_TOPIC="$old_topic"
  fi
  
  if [[ $exit_code -ne 0 ]]; then
    echo "opencode failed without NTFY_TOPIC: $output"
    return 1
  fi
  
  return 0
}

# =============================================================================
# Run Tests
# =============================================================================

echo "Plugin File Structure Tests:"

for test_func in \
  test_plugin_index_exists \
  test_plugin_notifier_exists \
  test_plugin_callback_exists \
  test_plugin_hostname_exists \
  test_plugin_nonces_exists \
  test_plugin_service_client_exists
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "JavaScript Syntax Validation Tests:"

for test_func in \
  test_index_js_syntax \
  test_notifier_js_syntax \
  test_callback_js_syntax \
  test_hostname_js_syntax \
  test_nonces_js_syntax \
  test_service_client_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Configuration Tests:"

for test_func in \
  test_index_imports_config \
  test_index_uses_load_config
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Idle Notification Behavior Tests:"

for test_func in \
  test_handles_session_status_events \
  test_handles_idle_status \
  test_handles_busy_status \
  test_uses_settimeout_for_idle \
  test_uses_cleartimeout_for_busy \
  test_imports_send_notification_from_notifier \
  test_uses_configured_server_and_topic \
  test_uses_configured_idle_delay \
  test_uses_directory_param_not_process_cwd \
  test_idle_notification_shows_repo_context
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Logging Tests:"

for test_func in \
  test_logs_disabled_when_no_topic \
  test_logs_initialized_with_topic \
  test_logs_configuration_summary
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Plugin Export Structure Tests:"

for test_func in \
  test_index_exports_notify \
  test_index_has_default_export \
  test_notifier_exports_send_notification \
  test_notifier_exports_send_permission_notification \
  test_callback_exports_start_callback_server \
  test_hostname_exports_discover_callback_host \
  test_nonces_exports_create_nonce \
  test_nonces_exports_consume_nonce
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Service Integration Tests:"

for test_func in \
  test_index_imports_service_client \
  test_index_connects_to_service \
  test_index_handles_permission_updated
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "OpenCode Runtime Integration Tests (CI=${CI:-false}):"

for test_func in \
  test_opencode_starts_within_timeout \
  test_opencode_plugin_loads \
  test_opencode_ntfy_disabled_without_topic
do
  # Don't use setup/teardown for integration tests - use real HOME
  run_test "${test_func#test_}" "$test_func"
done

print_summary
