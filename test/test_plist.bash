#!/usr/bin/env bash
#
# Tests for service/io.opencode.ntfy.plist - LaunchAgent plist for brew services
# Issue #13: Separate callback server as brew service
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing LaunchAgent plist..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_plist_file_exists() {
  assert_file_exists "$SERVICE_DIR/io.opencode.ntfy.plist"
}

test_plist_is_valid_xml() {
  if ! command -v plutil &>/dev/null; then
    echo "SKIP: plutil not available (macOS only)"
    return 0
  fi
  plutil -lint "$SERVICE_DIR/io.opencode.ntfy.plist" 2>&1 || {
    echo "plist is not valid XML"
    return 1
  }
}

# =============================================================================
# Content Tests
# =============================================================================

test_plist_has_label() {
  grep -q "<string>io.opencode.ntfy</string>" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "Label not found in plist"
    return 1
  }
}

test_plist_has_program_arguments() {
  grep -q "<key>ProgramArguments</key>" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "ProgramArguments not found in plist"
    return 1
  }
}

test_plist_runs_node() {
  grep -q "node" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "node command not found in plist"
    return 1
  }
}

test_plist_runs_server_js() {
  grep -q "server.js" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "server.js not found in plist"
    return 1
  }
}

test_plist_has_keep_alive() {
  grep -q "<key>KeepAlive</key>" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "KeepAlive not found in plist"
    return 1
  }
}

test_plist_has_run_at_load() {
  grep -q "<key>RunAtLoad</key>" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "RunAtLoad not found in plist"
    return 1
  }
}

test_plist_has_stdout_log() {
  grep -q "stdout\|StandardOutPath" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "Stdout logging not found in plist"
    return 1
  }
}

test_plist_has_stderr_log() {
  grep -q "stderr\|StandardErrorPath" "$SERVICE_DIR/io.opencode.ntfy.plist" || {
    echo "Stderr logging not found in plist"
    return 1
  }
}

# =============================================================================
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_plist_file_exists \
  test_plist_is_valid_xml
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Content Tests:"

for test_func in \
  test_plist_has_label \
  test_plist_has_program_arguments \
  test_plist_runs_node \
  test_plist_runs_server_js \
  test_plist_has_keep_alive \
  test_plist_has_run_at_load \
  test_plist_has_stdout_log \
  test_plist_has_stderr_log
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
