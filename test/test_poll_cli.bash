#!/usr/bin/env bash
#
# Tests for bin/opencode-pilot CLI (poll subcommand)
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

# =============================================================================
# Help Command Tests
# =============================================================================

test_cli_help_shows_usage() {
  "$CLI_PATH" help 2>&1 | grep -q "Usage:" || {
    echo "help command should show Usage"
    return 1
  }
}

test_cli_help_shows_poll_command() {
  "$CLI_PATH" help 2>&1 | grep -q "poll" || {
    echo "help command should show poll command"
    return 1
  }
}

test_cli_default_shows_help() {
  "$CLI_PATH" 2>&1 | grep -q "Usage:" || {
    echo "default should show usage"
    return 1
  }
}

# =============================================================================
# Poll Help Tests
# =============================================================================

test_poll_help_shows_options() {
  "$CLI_PATH" poll --help 2>&1 | grep -q -- "--dry-run" || {
    echo "poll --help should show --dry-run option"
    return 1
  }
}

test_poll_help_shows_config_option() {
  "$CLI_PATH" poll --help 2>&1 | grep -q -- "--config" || {
    echo "poll --help should show --config option"
    return 1
  }
}

test_poll_help_shows_interval_option() {
  "$CLI_PATH" poll --help 2>&1 | grep -q -- "--interval" || {
    echo "poll --help should show --interval option"
    return 1
  }
}

# =============================================================================
# Poll Dry Run Tests
# =============================================================================

test_poll_dry_run_requires_config() {
  setup_test_env
  
  # With no config, should report no config found
  local output
  output=$("$CLI_PATH" poll --dry-run 2>&1) || true
  
  cleanup_test_env
  
  # Should mention missing config or no sources
  echo "$output" | grep -qi "no.*config\|no.*sources\|not found" || {
    echo "dry-run without config should mention missing config"
    echo "Output: $output"
    return 1
  }
}

test_poll_dry_run_with_config() {
  setup_test_env
  
  # Create a minimal repos.yaml
  mkdir -p "$HOME/.config/opencode-pilot"
  cat > "$HOME/.config/opencode-pilot/repos.yaml" <<'EOF'
repos:
  testorg/testrepo:
    repo_path: /tmp/testrepo
    sources:
      - type: github_issue
        fetch:
          assignee: "@me"
EOF
  
  # Dry run should succeed and show what it would do
  local output
  local exit_code=0
  output=$("$CLI_PATH" poll --dry-run --once 2>&1) || exit_code=$?
  
  cleanup_test_env
  
  # Should complete without error (exit 0) or mention dry-run
  [[ $exit_code -eq 0 ]] || echo "$output" | grep -qi "dry" || {
    echo "dry-run with config should work"
    echo "Exit code: $exit_code"
    echo "Output: $output"
    return 1
  }
}

# =============================================================================
# Poll Status Tests
# =============================================================================

test_poll_status_command() {
  setup_test_env
  
  local output
  output=$("$CLI_PATH" poll status 2>&1) || true
  
  cleanup_test_env
  
  # Status should show WIP info
  echo "$output" | grep -qi "session\|wip\|active\|status" || {
    echo "poll status should show session/WIP info"
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
  test_cli_help_shows_poll_command \
  test_cli_default_shows_help
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Poll Help Tests:"

for test_func in \
  test_poll_help_shows_options \
  test_poll_help_shows_config_option \
  test_poll_help_shows_interval_option
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Poll Dry Run Tests:"

for test_func in \
  test_poll_dry_run_requires_config \
  test_poll_dry_run_with_config
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Poll Status Tests:"

for test_func in \
  test_poll_status_command
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
