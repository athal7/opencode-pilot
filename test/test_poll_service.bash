#!/usr/bin/env bash
#
# Tests for poll-service.js - Polling orchestration service
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing poll-service.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_poll_service_file_exists() {
  assert_file_exists "$SERVICE_DIR/poll-service.js"
}

test_poll_service_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/poll-service.js" 2>&1 || {
    echo "poll-service.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_poll_service_exports_start() {
  grep -q "export.*function startPolling\|export.*startPolling" "$SERVICE_DIR/poll-service.js" || {
    echo "startPolling export not found"
    return 1
  }
}

test_poll_service_exports_stop() {
  grep -q "export.*function stopPolling\|export.*stopPolling" "$SERVICE_DIR/poll-service.js" || {
    echo "stopPolling export not found"
    return 1
  }
}

test_poll_service_exports_poll_once() {
  grep -q "export.*function pollOnce\|export.*pollOnce" "$SERVICE_DIR/poll-service.js" || {
    echo "pollOnce export not found"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_poll_service_uses_repo_config() {
  grep -q "repo-config\|getRepoConfig\|getAllSources" "$SERVICE_DIR/poll-service.js" || {
    echo "repo-config usage not found"
    return 1
  }
}

test_poll_service_uses_poller() {
  grep -q "poller\|pollSource" "$SERVICE_DIR/poll-service.js" || {
    echo "poller usage not found"
    return 1
  }
}

test_poll_service_uses_readiness() {
  grep -q "readiness\|evaluateReadiness" "$SERVICE_DIR/poll-service.js" || {
    echo "readiness usage not found"
    return 1
  }
}

test_poll_service_uses_actions() {
  grep -q "actions\|executeAction" "$SERVICE_DIR/poll-service.js" || {
    echo "actions usage not found"
    return 1
  }
}

test_poll_service_respects_wip_limits() {
  grep -q "wip\|max_concurrent\|limit" "$SERVICE_DIR/poll-service.js" || {
    echo "WIP limit handling not found"
    return 1
  }
}

# =============================================================================
# Functional Tests
# =============================================================================

test_poll_service_dry_run() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { pollOnce } from './service/poll-service.js';
    
    // Run with dry-run flag (no actual polling)
    const results = await pollOnce({ dryRun: true, skipMcp: true });
    
    // Should return results array (even if empty)
    if (!Array.isArray(results)) {
      console.log('FAIL: pollOnce should return an array');
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
  test_poll_service_file_exists \
  test_poll_service_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_poll_service_exports_start \
  test_poll_service_exports_stop \
  test_poll_service_exports_poll_once
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_poll_service_uses_repo_config \
  test_poll_service_uses_poller \
  test_poll_service_uses_readiness \
  test_poll_service_uses_actions \
  test_poll_service_respects_wip_limits
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_poll_service_dry_run
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
