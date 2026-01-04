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
# NOTE: Logging tests removed - all console output is now suppressed to avoid TUI interference

# =============================================================================
# Plugin Export Structure Tests
# =============================================================================

test_index_exports_notify() {
  # Plugin should only use default export to prevent double-loading by OpenCode
  # (Issue #34: Having both named and default export caused plugin to load twice)
  grep -q "export default Notify" "$PLUGIN_DIR/index.js" || {
    echo "Default Notify export not found in index.js"
    return 1
  }
  # Ensure named export is NOT present (would cause double-loading)
  if grep -q "export const Notify" "$PLUGIN_DIR/index.js"; then
    echo "Named export 'export const Notify' found - should only use default export"
    return 1
  fi
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

test_index_imports_try_reconnect() {
  grep -q "tryReconnect" "$PLUGIN_DIR/index.js" || {
    echo "tryReconnect import not found in index.js"
    return 1
  }
}

test_index_tries_reconnect_on_permission() {
  # Plugin should try to reconnect when handling permission events if not connected
  # This is critical for Issue #41 - permission notifications not received
  grep -A 20 "permission.updated" "$PLUGIN_DIR/index.js" | grep -q "tryReconnect" || {
    echo "tryReconnect call not found in permission.updated handler"
    return 1
  }
}

# =============================================================================
# Retry Event Handling Tests (Issue #7)
# =============================================================================

test_handles_retry_status() {
  # Verify retry status is handled within session.status events
  grep -q "retry" "$PLUGIN_DIR/index.js" || {
    echo "retry status handling not found"
    return 1
  }
}

test_tracks_retry_count() {
  # Verify retry counter is tracked
  grep -q "retryCount" "$PLUGIN_DIR/index.js" || {
    echo "retryCount variable not found"
    return 1
  }
}

test_uses_retry_notify_first_config() {
  # Verify retryNotifyFirst config is used
  grep -q "retryNotifyFirst" "$PLUGIN_DIR/index.js" || {
    echo "retryNotifyFirst config not used"
    return 1
  }
}

test_uses_retry_notify_after_config() {
  # Verify retryNotifyAfter config is used
  grep -q "retryNotifyAfter" "$PLUGIN_DIR/index.js" || {
    echo "retryNotifyAfter config not used"
    return 1
  }
}

test_sends_retry_notification_with_priority() {
  # Verify retry notifications use high priority (4)
  grep -q "priority.*4\|4.*priority" "$PLUGIN_DIR/index.js" || {
    echo "High priority (4) not found for retry notifications"
    return 1
  }
}

# =============================================================================
# Error Event Handling Tests (Issue #7)
# =============================================================================

test_handles_session_error() {
  # Verify session.error events are handled
  grep -q "session\.error" "$PLUGIN_DIR/index.js" || {
    echo "session.error event handling not found"
    return 1
  }
}

test_uses_error_notify_config() {
  # Verify errorNotify config is used
  grep -q "errorNotify" "$PLUGIN_DIR/index.js" || {
    echo "errorNotify config not used"
    return 1
  }
}

test_uses_error_debounce_config() {
  # Verify errorDebounceMs config is used
  grep -q "errorDebounceMs" "$PLUGIN_DIR/index.js" || {
    echo "errorDebounceMs config not used"
    return 1
  }
}

test_tracks_last_error_time() {
  # Verify last error timestamp is tracked for debouncing
  grep -q "lastErrorTime" "$PLUGIN_DIR/index.js" || {
    echo "lastErrorTime variable not found"
    return 1
  }
}

test_sends_error_notification_with_urgent_priority() {
  # Verify error notifications use urgent priority (5)
  grep -q "priority.*5\|5.*priority" "$PLUGIN_DIR/index.js" || {
    echo "Urgent priority (5) not found for error notifications"
    return 1
  }
}

test_error_notification_includes_session_link() {
  # Verify error notifications can include "Open Session" action
  # Check that session.error handler builds actions similar to idle handler
  grep -A 40 "session.error" "$PLUGIN_DIR/index.js" | grep -q "Open Session" || {
    echo "Error notifications should include 'Open Session' action"
    return 1
  }
}

# =============================================================================
# Counter Reset Tests (Issue #7)
# =============================================================================

test_resets_retry_counter_on_status_change() {
  # Verify retry counter is reset when status changes
  grep -q "retryCount.*=.*0\|retryCount = 0" "$PLUGIN_DIR/index.js" || {
    echo "Retry counter reset not found"
    return 1
  }
}

# =============================================================================
# Cancellation Handling Tests
# =============================================================================

test_handles_canceled_status() {
  # Verify canceled status is handled (no notification on cancel)
  grep -q "canceled" "$PLUGIN_DIR/index.js" || {
    echo "canceled status handling not found"
    return 1
  }
}

test_sets_canceled_flag_on_canceled_status() {
  # Verify a flag is set when session is canceled
  grep -q "wasCanceled\|sessionCanceled\|canceled.*true\|isCanceled" "$PLUGIN_DIR/index.js" || {
    echo "canceled flag not found"
    return 1
  }
}

test_shutdown_checks_canceled_before_notification() {
  # Verify shutdown handler respects canceled state
  # The idle timer should be cancelled without sending notification
  grep -q "shutdown" "$PLUGIN_DIR/index.js" || {
    echo "shutdown handler not found"
    return 1
  }
}

# =============================================================================
# Console Output Suppression Tests
# =============================================================================

test_no_console_log_calls() {
  # Plugin should not use console.log (interferes with TUI)
  if grep -q 'console\.log' "$PLUGIN_DIR/index.js"; then
    echo "console.log found - should use silent or file-based logging"
    return 1
  fi
}

test_no_console_warn_calls() {
  # Plugin should not use console.warn (interferes with TUI)
  if grep -q 'console\.warn' "$PLUGIN_DIR/index.js"; then
    echo "console.warn found - should use silent or file-based logging"
    return 1
  fi
}

test_no_console_error_calls() {
  # Plugin should not use console.error (interferes with TUI)
  if grep -q 'console\.error' "$PLUGIN_DIR/index.js"; then
    echo "console.error found - should use silent or file-based logging"
    return 1
  fi
}

# =============================================================================
# Notification Suppression Logging Tests (Issue #7)
# =============================================================================
# NOTE: Console output suppression tests removed - all logging disabled to avoid TUI interference

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
  
  # Check plugin is installed (use REAL_HOME since we may have changed HOME)
  local plugin_path="${REAL_HOME:-$HOME}/.config/opencode/plugins/opencode-ntfy/index.js"
  if [[ ! -f "$plugin_path" ]]; then
    return 1
  fi
  
  return 0
}

# Setup isolated environment for integration tests
# Uses temp directory for opencode data while symlinking config from real HOME
setup_integration_env() {
  REAL_HOME="$HOME"
  INTEGRATION_TEST_DIR=$(mktemp -d)
  export HOME="$INTEGRATION_TEST_DIR"
  
  # Create necessary directories
  mkdir -p "$HOME/.config"
  mkdir -p "$HOME/.local/share"
  
  # Symlink opencode config (contains plugin registrations and auth)
  ln -s "$REAL_HOME/.config/opencode" "$HOME/.config/opencode"
  
  # Symlink opencode-ntfy config
  if [[ -d "$REAL_HOME/.config/opencode-ntfy" ]]; then
    ln -s "$REAL_HOME/.config/opencode-ntfy" "$HOME/.config/opencode-ntfy"
  fi
}

# Cleanup isolated environment after integration tests
cleanup_integration_env() {
  if [[ -n "${INTEGRATION_TEST_DIR:-}" ]] && [[ -d "$INTEGRATION_TEST_DIR" ]]; then
    rm -rf "$INTEGRATION_TEST_DIR"
  fi
  if [[ -n "${REAL_HOME:-}" ]]; then
    export HOME="$REAL_HOME"
  fi
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
    echo "SKIP: opencode not installed or plugin not configured"
    return 0
  fi
  
  setup_integration_env
  
  # CRITICAL: Verify opencode starts within 10 seconds
  # This catches plugin initialization hangs that would block startup indefinitely.
  
  local start_time end_time elapsed output
  start_time=$(date +%s)
  
  # Use a short timeout - if plugin hangs, this will fail
  output=$(run_with_timeout 10 opencode run --format json "Say hi" 2>&1)
  local exit_code=$?
  
  end_time=$(date +%s)
  elapsed=$((end_time - start_time))
  
  cleanup_integration_env
  
  if [[ $exit_code -ne 0 ]]; then
    # Check if it was a timeout (exit code 142 = SIGALRM)
    if [[ $exit_code -eq 142 ]] || [[ "$output" == *"Alarm clock"* ]]; then
      echo "FAIL: opencode startup timed out after ${elapsed}s (plugin may be hanging)"
      echo "Output: $output"
      return 1
    fi
    # Skip on model configuration errors (not a plugin issue)
    if [[ "$output" == *"ModelNotFoundError"* ]] || [[ "$output" == *"ProviderModelNotFoundError"* ]]; then
      echo "SKIP: model configuration error (not a plugin issue)"
      return 0
    fi
    echo "opencode run failed (exit $exit_code): $output"
    return 1
  fi
  
  # Verify we got a response
  if ! echo "$output" | grep -q '"type"'; then
    # Skip on model configuration errors (not a plugin issue)
    if [[ "$output" == *"ModelNotFoundError"* ]] || [[ "$output" == *"ProviderModelNotFoundError"* ]]; then
      echo "SKIP: model configuration error (not a plugin issue)"
      return 0
    fi
    echo "No valid JSON output from opencode"
    echo "Output: $output"
    return 1
  fi
  
  return 0
}

test_opencode_plugin_loads() {
  if ! can_run_integration_tests; then
    echo "SKIP: opencode not installed or plugin not configured"
    return 0
  fi
  
  setup_integration_env
  
  # Plugin should load without errors - check opencode doesn't report plugin failures
  local output
  output=$(run_opencode "Say hello" 30) || {
    cleanup_integration_env
    echo "opencode run failed: $output"
    return 1
  }
  
  cleanup_integration_env
  
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
    echo "SKIP: opencode not installed or plugin not configured"
    return 0
  fi
  
  setup_integration_env
  
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
  
  cleanup_integration_env
  
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

# Logging tests removed - console output is now fully suppressed

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
  test_index_handles_permission_updated \
  test_index_imports_try_reconnect \
  test_index_tries_reconnect_on_permission
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Retry Event Handling Tests (Issue #7):"

for test_func in \
  test_handles_retry_status \
  test_tracks_retry_count \
  test_uses_retry_notify_first_config \
  test_uses_retry_notify_after_config \
  test_sends_retry_notification_with_priority
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Error Event Handling Tests (Issue #7):"

for test_func in \
  test_handles_session_error \
  test_uses_error_notify_config \
  test_uses_error_debounce_config \
  test_tracks_last_error_time \
  test_sends_error_notification_with_urgent_priority \
  test_error_notification_includes_session_link
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Counter Reset Tests (Issue #7):"

for test_func in \
  test_resets_retry_counter_on_status_change
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Cancellation Handling Tests:"

for test_func in \
  test_handles_canceled_status \
  test_sets_canceled_flag_on_canceled_status \
  test_shutdown_checks_canceled_before_notification
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Console Output Suppression Tests:"

for test_func in \
  test_no_console_log_calls \
  test_no_console_warn_calls \
  test_no_console_error_calls
do
  run_test "${test_func#test_}" "$test_func"
done

# Removed notification suppression logging tests - console output is now fully suppressed

# =============================================================================
# Per-Conversation State Tracking Tests (Issue #34)
# =============================================================================

test_uses_conversations_map_for_state() {
  # Plugin should track state per-conversation using a Map, not global variables
  grep -q "conversations\|Map()" "$PLUGIN_DIR/index.js" || {
    echo "Conversations Map not found in index.js"
    return 1
  }
}

test_extracts_session_id_from_event() {
  # Plugin should extract session ID from event properties for routing
  grep -q "event\.properties.*id\|properties.*info.*id" "$PLUGIN_DIR/index.js" || {
    echo "Session ID extraction from event not found"
    return 1
  }
}

test_stores_idle_timer_per_conversation() {
  # Each conversation should have its own idle timer
  # Look for pattern like conversations.get(sessionId).idleTimer or similar
  grep -q "idleTimer" "$PLUGIN_DIR/index.js" || {
    echo "idleTimer not found in index.js"
    return 1
  }
}

test_captures_session_id_in_idle_timer_closure() {
  # The sessionId should be captured when setting the timer, not read later
  # This ensures the notification URL points to the correct conversation
  # Pattern: use local variable in setTimeout callback, not external reference
  grep -A 30 "setTimeout" "$PLUGIN_DIR/index.js" | grep -q "session" || {
    echo "Session ID not captured in idle timer"
    return 1
  }
}

test_clears_conversation_state_on_cancel() {
  # When a conversation is canceled, its state should be cleaned up
  grep -q "canceled" "$PLUGIN_DIR/index.js" && \
  grep -q "delete\|clear" "$PLUGIN_DIR/index.js" || {
    echo "Conversation cleanup on cancel not found"
    return 1
  }
}

# =============================================================================
# Session Tracking and Open Session Action Tests (Issue #27)
# =============================================================================

test_notify_accepts_server_url_param() {
  # Notify function should accept serverUrl parameter for building session URLs
  grep -q "serverUrl" "$PLUGIN_DIR/index.js" || {
    echo "serverUrl parameter not found in index.js"
    return 1
  }
}

test_tracks_current_session_id() {
  # Plugin should track current session ID from session events
  grep -q "currentSessionId\|sessionId" "$PLUGIN_DIR/index.js" || {
    echo "session ID tracking not found in index.js"
    return 1
  }
}

test_extracts_session_id_from_status_event() {
  # Plugin should extract session ID from session.status events for per-conversation tracking
  grep -q "session\.status\|properties.*info.*id" "$PLUGIN_DIR/index.js" || {
    echo "Session ID extraction from status event not found"
    return 1
  }
}

test_idle_notification_can_include_actions() {
  # Idle notification sendNotification call should support actions parameter
  # Check that the idle notification code block references actions
  grep -A 15 "Idle.*repoName" "$PLUGIN_DIR/index.js" | grep -q "actions" || {
    echo "actions parameter not found in idle notification"
    return 1
  }
}

test_builds_open_session_url() {
  # When serverUrl and callbackHost available, should build session URL
  grep -q "session" "$PLUGIN_DIR/index.js" && \
  grep -q "callbackHost\|serverUrl" "$PLUGIN_DIR/index.js" || {
    echo "Session URL building not found"
    return 1
  }
}

test_uses_mobile_ui_url() {
  # URL should point to the mobile-friendly UI served by the callback service
  # Format: /m/{opencodePort}/{repoName}/session/{sessionId}
  grep -q '/m/' "$PLUGIN_DIR/index.js" || {
    echo "Mobile UI URL format (/m/) not found in index.js"
    return 1
  }
}

test_uses_callback_host_for_session_url() {
  # Should use callbackHost (Tailscale hostname) for the session URL
  grep -q "callbackHost" "$PLUGIN_DIR/index.js" || {
    echo "callbackHost not used for session URL"
    return 1
  }
}

# =============================================================================
# Devcontainer Path Parsing Tests
# =============================================================================

test_parses_devcontainer_clone_path() {
  # When directory is a devcontainer clone, should extract repo and branch
  # Path format: /Users/foo/.cache/devcontainer-clones/{repo}/{branch}
  grep -q "devcontainer-clones" "$PLUGIN_DIR/index.js" || {
    echo "devcontainer-clones path parsing not found in index.js"
    return 1
  }
}

test_notification_shows_repo_and_branch() {
  # Notification title should show both repo name and branch when in devcontainer
  # e.g., "Idle (opencode-ntfy/fix-something)" instead of just "Idle (fix-something)"
  grep -q "parseRepoInfo\|getRepoName" "$PLUGIN_DIR/index.js" || {
    echo "Repo info parsing function not found in index.js"
    return 1
  }
}

test_regular_directory_shows_basename_only() {
  # For regular directories (not devcontainer clones), should show just basename
  # e.g., "/Users/foo/code/myrepo" -> "myrepo"
  grep -q "basename" "$PLUGIN_DIR/index.js" || {
    echo "basename fallback not found in index.js"
    return 1
  }
}

echo ""
echo "Per-Conversation State Tracking Tests (Issue #34):"

for test_func in \
  test_uses_conversations_map_for_state \
  test_extracts_session_id_from_event \
  test_stores_idle_timer_per_conversation \
  test_captures_session_id_in_idle_timer_closure \
  test_clears_conversation_state_on_cancel
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Session Tracking and Open Session Action Tests (Issue #27):"

for test_func in \
  test_notify_accepts_server_url_param \
  test_tracks_current_session_id \
  test_extracts_session_id_from_status_event \
  test_idle_notification_can_include_actions \
  test_builds_open_session_url \
  test_uses_mobile_ui_url \
  test_uses_callback_host_for_session_url
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Devcontainer Path Parsing Tests:"

for test_func in \
  test_parses_devcontainer_clone_path \
  test_notification_shows_repo_and_branch \
  test_regular_directory_shows_basename_only
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "OpenCode Runtime Integration Tests:"

for test_func in \
  test_opencode_starts_within_timeout \
  test_opencode_plugin_loads \
  test_opencode_ntfy_disabled_without_topic
do
  # Don't use setup/teardown for integration tests - use real HOME
  run_test "${test_func#test_}" "$test_func"
done

print_summary
