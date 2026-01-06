#!/usr/bin/env bash
#
# Tests for poller.js - MCP-based polling for automation sources
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing poller.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_poller_file_exists() {
  assert_file_exists "$SERVICE_DIR/poller.js"
}

test_poller_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/poller.js" 2>&1 || {
    echo "poller.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_poller_exports_create_poller() {
  grep -q "export.*function createPoller\|export.*createPoller" "$SERVICE_DIR/poller.js" || {
    echo "createPoller export not found in poller.js"
    return 1
  }
}

test_poller_exports_poll_generic_source() {
  grep -q "export.*function pollGenericSource\|export.*pollGenericSource" "$SERVICE_DIR/poller.js" || {
    echo "pollGenericSource export not found in poller.js"
    return 1
  }
}

test_poller_exports_apply_mappings() {
  grep -q "export.*function applyMappings\|export.*applyMappings" "$SERVICE_DIR/poller.js" || {
    echo "applyMappings export not found in poller.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_poller_uses_mcp_client() {
  grep -q "@modelcontextprotocol/sdk" "$SERVICE_DIR/poller.js" || {
    echo "MCP SDK import not found in poller.js"
    return 1
  }
}

test_poller_tracks_processed_items() {
  grep -q "processed\|state\|seen" "$SERVICE_DIR/poller.js" || {
    echo "Processed items tracking not found in poller.js"
    return 1
  }
}

test_poller_supports_generic_tools() {
  grep -q "tool" "$SERVICE_DIR/poller.js" || {
    echo "Tool-based polling not found in poller.js"
    return 1
  }
}

# =============================================================================
# Run Tests
# =============================================================================

echo "File Structure Tests:"

for test_func in \
  test_poller_file_exists \
  test_poller_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_poller_exports_create_poller \
  test_poller_exports_poll_generic_source \
  test_poller_exports_apply_mappings
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_poller_uses_mcp_client \
  test_poller_tracks_processed_items \
  test_poller_supports_generic_tools
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
