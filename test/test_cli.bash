#!/usr/bin/env bash
#
# Tests for bin/opencode-pilot CLI
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI_PATH="$PROJECT_DIR/bin/opencode-pilot"

echo "Testing opencode-pilot CLI..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_cli_file_exists() {
  assert_file_exists "$CLI_PATH"
}

test_cli_is_executable() {
  [[ -x "$CLI_PATH" ]] || {
    echo "CLI is not executable"
    return 1
  }
}

test_cli_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$CLI_PATH" 2>&1 || {
    echo "CLI has syntax errors"
    return 1
  }
}

# =============================================================================
# Help Command Tests
# =============================================================================

test_cli_help_shows_usage() {
  "$CLI_PATH" help 2>&1 | grep -q "Usage:" || {
    echo "help command should show Usage"
    return 1
  }
}

test_cli_help_shows_setup_command() {
  "$CLI_PATH" help 2>&1 | grep -q "setup" || {
    echo "help command should show setup command"
    return 1
  }
}

test_cli_help_shows_status_command() {
  "$CLI_PATH" help 2>&1 | grep -q "status" || {
    echo "help command should show status command"
    return 1
  }
}

test_cli_default_shows_help() {
  "$CLI_PATH" 2>&1 | grep -q "Usage:" || {
    echo "default should show usage"
    return 1
  }
}

test_cli_unknown_command_shows_error() {
  local output
  output=$("$CLI_PATH" unknowncommand 2>&1) || true
  
  echo "$output" | grep -q "Unknown command" || {
    echo "unknown command should show error"
    echo "Output: $output"
    return 1
  }
}

# =============================================================================
# Status Command Tests
# =============================================================================

test_cli_status_shows_plugin_info() {
  local output
  output=$("$CLI_PATH" status 2>&1) || true
  
  echo "$output" | grep -qi "plugin" || {
    echo "status should show plugin info"
    echo "Output: $output"
    return 1
  }
}

test_cli_status_shows_notification_config() {
  local output
  output=$("$CLI_PATH" status 2>&1) || true
  
  echo "$output" | grep -qi "notification\|topic" || {
    echo "status should show notification config"
    echo "Output: $output"
    return 1
  }
}

test_cli_status_shows_polling_config() {
  local output
  output=$("$CLI_PATH" status 2>&1) || true
  
  echo "$output" | grep -qi "polling\|repos.yaml" || {
    echo "status should show polling config"
    echo "Output: $output"
    return 1
  }
}

# =============================================================================
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_cli_file_exists \
  test_cli_is_executable \
  test_cli_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Help Command Tests:"

for test_func in \
  test_cli_help_shows_usage \
  test_cli_help_shows_setup_command \
  test_cli_help_shows_status_command \
  test_cli_default_shows_help \
  test_cli_unknown_command_shows_error
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Status Command Tests:"

for test_func in \
  test_cli_status_shows_plugin_info \
  test_cli_status_shows_notification_config \
  test_cli_status_shows_polling_config
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
