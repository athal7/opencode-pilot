#!/usr/bin/env bash
#
# Tests for bin/opencode-pilot CLI (setup and status commands)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI_PATH="$PROJECT_DIR/bin/opencode-pilot"

echo "Testing opencode-pilot CLI (setup/status)..."
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

test_cli_help_shows_setup() {
  "$CLI_PATH" help 2>&1 | grep -q "setup" || {
    echo "help command should show setup command"
    return 1
  }
}

test_cli_help_shows_status() {
  "$CLI_PATH" help 2>&1 | grep -q "status" || {
    echo "help command should show status command"
    return 1
  }
}

# =============================================================================
# Status Command Tests
# =============================================================================

test_status_shows_header() {
  local output
  output=$("$CLI_PATH" status 2>&1)
  echo "$output" | grep -q "opencode-pilot status" || {
    echo "status should show header"
    return 1
  }
}

test_status_shows_notification_config() {
  local output
  output=$("$CLI_PATH" status 2>&1)
  echo "$output" | grep -q "Notification Configuration:" || {
    echo "status should show Notification Configuration section"
    return 1
  }
}

test_status_shows_polling_config() {
  local output
  output=$("$CLI_PATH" status 2>&1)
  echo "$output" | grep -q "Polling Configuration:" || {
    echo "status should show Polling Configuration section"
    return 1
  }
}

test_status_reads_config_file() {
  setup_test_env
  
  # Create a config file with test values
  mkdir -p "$HOME/.config/opencode-pilot"
  cat > "$HOME/.config/opencode-pilot/config.json" <<EOF
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

test_status_shows_not_set_when_missing() {
  setup_test_env
  
  # Create an empty config file
  mkdir -p "$HOME/.config/opencode-pilot"
  echo '{}' > "$HOME/.config/opencode-pilot/config.json"
  
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
  mkdir -p "$HOME/.config/opencode-pilot"
  cat > "$HOME/.config/opencode-pilot/config.json" <<EOF
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
# Setup Command - Backup Tests
# =============================================================================

test_setup_creates_backup_before_modification() {
  setup_test_env
  
  # Create existing opencode.json with some content
  mkdir -p "$HOME/.config/opencode"
  cat > "$HOME/.config/opencode/opencode.json" <<EOF
{
  "someKey": "existingValue"
}
EOF
  
  # Run setup (it will fail to find plugin source, but should backup first)
  local output
  output=$("$CLI_PATH" setup 2>&1) || true
  
  # Check for backup file (timestamped)
  local backup_files
  backup_files=$(ls "$HOME/.config/opencode/opencode.json.backup."* 2>/dev/null | wc -l | tr -d ' ')
  
  cleanup_test_env
  
  [[ "$backup_files" -gt 0 ]] || {
    echo "setup should create a backup file before modification"
    echo "Output: $output"
    return 1
  }
}

test_setup_backup_contains_original_content() {
  setup_test_env
  
  # Create existing opencode.json with specific content
  mkdir -p "$HOME/.config/opencode"
  cat > "$HOME/.config/opencode/opencode.json" <<EOF
{
  "existingKey": "mustBePreserved"
}
EOF
  
  # Run setup
  "$CLI_PATH" setup 2>&1 || true
  
  # Find backup file and check content
  local backup_file
  backup_file=$(ls "$HOME/.config/opencode/opencode.json.backup."* 2>/dev/null | head -1)
  
  local result=0
  if [[ -n "$backup_file" ]]; then
    grep -q "mustBePreserved" "$backup_file" || result=1
  else
    result=1
  fi
  
  cleanup_test_env
  
  [[ $result -eq 0 ]] || {
    echo "backup file should contain original content"
    return 1
  }
}

test_setup_shows_backup_location() {
  setup_test_env
  
  # Create existing opencode.json
  mkdir -p "$HOME/.config/opencode"
  echo '{}' > "$HOME/.config/opencode/opencode.json"
  
  # Run setup and capture output
  local output
  output=$("$CLI_PATH" setup 2>&1) || true
  
  cleanup_test_env
  
  # Output should mention backup location
  echo "$output" | grep -qi "backup.*opencode.json\|Backup created" || {
    echo "setup should show backup location in output"
    echo "Output: $output"
    return 1
  }
}

test_setup_uses_atomic_write() {
  # This test verifies the implementation uses atomic write pattern
  # by checking for temp file usage in the code
  grep -q "\.tmp" "$CLI_PATH" || {
    echo "setup should use temp file for atomic write"
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
  test_cli_help_shows_setup \
  test_cli_help_shows_status
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Status Command Tests:"

for test_func in \
  test_status_shows_header \
  test_status_shows_notification_config \
  test_status_shows_polling_config \
  test_status_reads_config_file \
  test_status_shows_not_set_when_missing \
  test_status_env_overrides_config
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Setup Command - Backup Tests:"

for test_func in \
  test_setup_creates_backup_before_modification \
  test_setup_backup_contains_original_content \
  test_setup_shows_backup_location \
  test_setup_uses_atomic_write
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
