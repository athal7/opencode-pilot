#!/usr/bin/env bash
#
# Tests for notifier.js - ntfy HTTP client module
# Issue #3: Notifier: ntfy HTTP client with all notification types
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing notifier.js module..."
echo ""

# =============================================================================
# sendNotification Function Tests
# =============================================================================

test_notifier_exports_send_notification() {
  grep -q "export.*function sendNotification" "$PLUGIN_DIR/notifier.js" || \
  grep -q "export async function sendNotification" "$PLUGIN_DIR/notifier.js" || {
    echo "sendNotification export not found in notifier.js"
    return 1
  }
}

test_send_notification_uses_fetch() {
  # sendNotification should use native fetch() for HTTP requests
  grep -q "fetch(" "$PLUGIN_DIR/notifier.js" || {
    echo "fetch() not found in notifier.js - should use native fetch"
    return 1
  }
}

test_send_notification_posts_to_ntfy() {
  # Should POST to the ntfy server URL
  grep -q "method.*POST\|POST.*method" "$PLUGIN_DIR/notifier.js" || {
    echo "POST method not found in notifier.js"
    return 1
  }
}

test_send_notification_sends_json() {
  # Should send JSON content type
  grep -q "application/json" "$PLUGIN_DIR/notifier.js" || {
    echo "JSON content type not found in notifier.js"
    return 1
  }
}

test_send_notification_includes_topic() {
  # Body should include topic
  grep -q "topic" "$PLUGIN_DIR/notifier.js" || {
    echo "topic not used in notifier.js"
    return 1
  }
}

test_send_notification_includes_title() {
  # Body should include title
  grep -q "title" "$PLUGIN_DIR/notifier.js" || {
    echo "title not used in notifier.js"
    return 1
  }
}

test_send_notification_includes_message() {
  # Body should include message
  grep -q "message" "$PLUGIN_DIR/notifier.js" || {
    echo "message not used in notifier.js"
    return 1
  }
}

test_send_notification_handles_optional_priority() {
  # Priority is optional (1-5)
  grep -q "priority" "$PLUGIN_DIR/notifier.js" || {
    echo "priority not handled in notifier.js"
    return 1
  }
}

test_send_notification_handles_optional_tags() {
  # Tags are optional (emoji tags)
  grep -q "tags" "$PLUGIN_DIR/notifier.js" || {
    echo "tags not handled in notifier.js"
    return 1
  }
}

test_send_notification_catches_errors() {
  # Should catch network errors gracefully
  grep -q "catch" "$PLUGIN_DIR/notifier.js" || {
    echo "Error handling (catch) not found in notifier.js"
    return 1
  }
}

test_send_notification_handles_errors_silently() {
  # Should handle errors silently (no console output to avoid TUI interference)
  grep -q "catch" "$PLUGIN_DIR/notifier.js" || {
    echo "Error handling (catch) not found in notifier.js"
    return 1
  }
  # Should NOT have console output
  if grep -q "console\.\(error\|warn\|log\)" "$PLUGIN_DIR/notifier.js"; then
    echo "Console output found - should be silent to avoid TUI interference"
    return 1
  fi
}

test_send_notification_supports_auth_token() {
  # Should support optional auth token for ntfy Bearer auth
  grep -q "token\|Token\|auth\|Auth\|Bearer" "$PLUGIN_DIR/notifier.js" || {
    echo "Auth token support not found in notifier.js"
    return 1
  }
}

test_send_notification_uses_bearer_auth() {
  # Should use Authorization: Bearer header when token provided
  grep -q "Authorization.*Bearer\|Bearer.*Authorization" "$PLUGIN_DIR/notifier.js" || {
    echo "Bearer auth header not found in notifier.js"
    return 1
  }
}



# =============================================================================
# Deduplication Tests
# =============================================================================

test_notifier_has_deduplication() {
  # Should have deduplication to prevent duplicate notifications
  grep -q "isDuplicate\|dedupe\|Dedupe" "$PLUGIN_DIR/notifier.js" || {
    echo "Deduplication logic not found in notifier.js"
    return 1
  }
}

test_notifier_deduplicates_same_notification() {
  # Same notification sent twice within window should be deduplicated
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    // Import the module to access the dedupe functions
    import { sendNotification } from './plugin/notifier.js';
    
    // Mock fetch to count calls
    let fetchCount = 0;
    global.fetch = async () => { fetchCount++; return { ok: true }; };
    
    // Send same notification twice
    await sendNotification({ server: 'http://test', topic: 'test', title: 'Test', message: 'Hello' });
    await sendNotification({ server: 'http://test', topic: 'test', title: 'Test', message: 'Hello' });
    
    if (fetchCount !== 1) {
      console.log('FAIL: Expected 1 fetch call (deduplicated), got ' + fetchCount);
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

test_notifier_allows_different_notifications() {
  # Different notifications should not be deduplicated
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { sendNotification } from './plugin/notifier.js';
    
    // Mock fetch to count calls
    let fetchCount = 0;
    global.fetch = async () => { fetchCount++; return { ok: true }; };
    
    // Send different notifications
    await sendNotification({ server: 'http://test', topic: 'test', title: 'Test', message: 'Hello 1' });
    await sendNotification({ server: 'http://test', topic: 'test', title: 'Test', message: 'Hello 2' });
    
    if (fetchCount !== 2) {
      console.log('FAIL: Expected 2 fetch calls (different messages), got ' + fetchCount);
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
# Debug Logging Tests
# =============================================================================

test_notifier_imports_logger() {
  grep -q "import.*logger\|from.*logger" "$PLUGIN_DIR/notifier.js" || {
    echo "logger import not found in notifier.js"
    return 1
  }
}

test_notifier_logs_send_notification() {
  # Should log notification send attempts
  grep -q "debug.*[Nn]otification\|debug.*[Ss]end" "$PLUGIN_DIR/notifier.js" || {
    echo "debug logging for notification send not found in notifier.js"
    return 1
  }
}

test_notifier_logs_deduplication() {
  # Should log when deduplicating
  grep -q "debug.*[Dd]edupe\|debug.*[Ss]kip\|debug.*[Dd]uplicate" "$PLUGIN_DIR/notifier.js" || {
    echo "debug logging for deduplication not found in notifier.js"
    return 1
  }
}

# =============================================================================
# No-Implementation Check (should throw until implemented)
# =============================================================================

test_notifier_not_implemented_placeholder_removed() {
  # After implementation, the "Not implemented" error should be removed
  if grep -q "throw new Error.*Not implemented" "$PLUGIN_DIR/notifier.js"; then
    echo "notifier.js still has 'Not implemented' placeholder"
    return 1
  fi
  return 0
}

# =============================================================================
# Run Tests
# =============================================================================

echo "sendNotification Function Tests:"

for test_func in \
  test_notifier_exports_send_notification \
  test_send_notification_uses_fetch \
  test_send_notification_posts_to_ntfy \
  test_send_notification_sends_json \
  test_send_notification_includes_topic \
  test_send_notification_includes_title \
  test_send_notification_includes_message \
  test_send_notification_handles_optional_priority \
  test_send_notification_handles_optional_tags \
  test_send_notification_catches_errors \
  test_send_notification_handles_errors_silently \
  test_send_notification_supports_auth_token \
  test_send_notification_uses_bearer_auth
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Deduplication Tests:"

for test_func in \
  test_notifier_has_deduplication \
  test_notifier_deduplicates_same_notification \
  test_notifier_allows_different_notifications
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Debug Logging Tests:"

for test_func in \
  test_notifier_imports_logger \
  test_notifier_logs_send_notification \
  test_notifier_logs_deduplication
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Status Tests:"

for test_func in \
  test_notifier_not_implemented_placeholder_removed
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
