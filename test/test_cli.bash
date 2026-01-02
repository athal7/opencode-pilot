#!/usr/bin/env bash
#
# Tests for bin/opencode-ntfy CLI
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI_PATH="$PROJECT_DIR/bin/opencode-ntfy"

echo "Testing opencode-ntfy CLI..."
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

# =============================================================================
# Help Command Tests
# =============================================================================

test_cli_help_shows_usage() {
  "$CLI_PATH" help 2>&1 | grep -q "Usage:" || {
    echo "help command should show Usage"
    return 1
  }
}

test_cli_help_shows_commands() {
  "$CLI_PATH" help 2>&1 | grep -q "Commands:" || {
    echo "help command should show Commands"
    return 1
  }
}

# =============================================================================
# Status Command Tests
# =============================================================================

test_status_shows_header() {
  local output
  output=$("$CLI_PATH" status 2>&1)
  echo "$output" | grep -q "opencode-ntfy status" || {
    echo "status should show header"
    return 1
  }
}

test_status_shows_config_section() {
  # Status should have a Configuration section showing config file values
  local output
  output=$("$CLI_PATH" status 2>&1)
  echo "$output" | grep -q "Configuration:" || {
    echo "status should show Configuration section"
    return 1
  }
}

test_status_reads_config_file() {
  setup_test_env
  
  # Create a config file with test values
  mkdir -p "$HOME/.config/opencode-ntfy"
  cat > "$HOME/.config/opencode-ntfy/config.json" <<EOF
{
  "topic": "test-topic-123",
  "callbackHost": "test-host.example.com"
}
EOF
  
  # Status should show values from config file
  local output
  output=$("$CLI_PATH" status 2>&1)
  
  cleanup_test_env
  
  echo "$output" | grep -q "test-topic-123" || {
    echo "status should show topic from config file"
    echo "Output: $output"
    return 1
  }
}

test_status_shows_callback_host_from_config() {
  setup_test_env
  
  # Create a config file with callbackHost
  mkdir -p "$HOME/.config/opencode-ntfy"
  cat > "$HOME/.config/opencode-ntfy/config.json" <<EOF
{
  "topic": "my-topic",
  "callbackHost": "my-tailscale-host.ts.net"
}
EOF
  
  # Status should show callbackHost from config file
  local output
  output=$("$CLI_PATH" status 2>&1)
  
  cleanup_test_env
  
  echo "$output" | grep -q "my-tailscale-host.ts.net" || {
    echo "status should show callbackHost from config file"
    echo "Output: $output"
    return 1
  }
}

test_status_shows_not_set_when_missing() {
  setup_test_env
  
  # Create an empty config file
  mkdir -p "$HOME/.config/opencode-ntfy"
  echo '{}' > "$HOME/.config/opencode-ntfy/config.json"
  
  # Unset any env vars
  unset NTFY_TOPIC NTFY_CALLBACK_HOST 2>/dev/null || true
  
  # Status should show "not set" for missing values
  local output
  output=$("$CLI_PATH" status 2>&1)
  
  cleanup_test_env
  
  # Should indicate topic is not configured
  echo "$output" | grep -qi "topic.*not set\|topic.*<not" || {
    echo "status should indicate topic is not set"
    echo "Output: $output"
    return 1
  }
}

test_status_env_overrides_config() {
  setup_test_env
  
  # Create a config file
  mkdir -p "$HOME/.config/opencode-ntfy"
  cat > "$HOME/.config/opencode-ntfy/config.json" <<EOF
{
  "topic": "config-topic"
}
EOF
  
  # Set env var to override
  export NTFY_TOPIC="env-topic"
  
  local output
  output=$("$CLI_PATH" status 2>&1)
  
  unset NTFY_TOPIC
  cleanup_test_env
  
  # Should show env var value, not config file value
  echo "$output" | grep -q "env-topic" || {
    echo "status should show env var value when set"
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
  test_cli_is_executable
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Help Command Tests:"

for test_func in \
  test_cli_help_shows_usage \
  test_cli_help_shows_commands
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Status Command Tests:"

for test_func in \
  test_status_shows_header \
  test_status_shows_config_section \
  test_status_reads_config_file \
  test_status_shows_callback_host_from_config \
  test_status_shows_not_set_when_missing \
  test_status_env_overrides_config
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
