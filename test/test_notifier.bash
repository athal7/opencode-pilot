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

test_send_notification_logs_errors() {
  # Should log errors but not crash
  grep -q "console\.\(error\|warn\|log\).*\(error\|Error\|fail\)" "$PLUGIN_DIR/notifier.js" || \
  grep -q "\(error\|Error\|fail\).*console\.\(error\|warn\|log\)" "$PLUGIN_DIR/notifier.js" || {
    echo "Error logging not found in notifier.js"
    return 1
  }
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
# sendPermissionNotification Function Tests
# =============================================================================

test_notifier_exports_send_permission_notification() {
  grep -q "export.*function sendPermissionNotification" "$PLUGIN_DIR/notifier.js" || \
  grep -q "export async function sendPermissionNotification" "$PLUGIN_DIR/notifier.js" || {
    echo "sendPermissionNotification export not found in notifier.js"
    return 1
  }
}

test_permission_notification_includes_actions() {
  # Permission notification needs action buttons
  grep -q "actions" "$PLUGIN_DIR/notifier.js" || {
    echo "actions not found in notifier.js - permission notifications need action buttons"
    return 1
  }
}

test_permission_notification_has_allow_once_action() {
  # Should have "Allow Once" button
  grep -q "Allow Once" "$PLUGIN_DIR/notifier.js" || {
    echo "'Allow Once' action not found in notifier.js"
    return 1
  }
}

test_permission_notification_has_allow_always_action() {
  # Should have "Allow Always" button  
  grep -q "Allow Always" "$PLUGIN_DIR/notifier.js" || {
    echo "'Allow Always' action not found in notifier.js"
    return 1
  }
}

test_permission_notification_has_reject_action() {
  # Should have "Reject" button
  grep -q "Reject" "$PLUGIN_DIR/notifier.js" || {
    echo "'Reject' action not found in notifier.js"
    return 1
  }
}

test_permission_notification_uses_http_action_type() {
  # ntfy actions should be HTTP type for callbacks
  grep -q '"http"' "$PLUGIN_DIR/notifier.js" || \
  grep -q "'http'" "$PLUGIN_DIR/notifier.js" || {
    echo "HTTP action type not found in notifier.js"
    return 1
  }
}

test_permission_notification_uses_callback_url() {
  # Actions should use the callbackUrl parameter
  grep -q "callbackUrl" "$PLUGIN_DIR/notifier.js" || {
    echo "callbackUrl not used in notifier.js"
    return 1
  }
}

test_permission_notification_includes_nonce() {
  # Actions should include nonce in URL
  grep -q "nonce" "$PLUGIN_DIR/notifier.js" || {
    echo "nonce not included in notifier.js action URLs"
    return 1
  }
}

test_permission_notification_includes_response_param() {
  # Actions should include response parameter (once/always/reject)
  grep -q "response=" "$PLUGIN_DIR/notifier.js" || \
  grep -q "response:" "$PLUGIN_DIR/notifier.js" || {
    echo "response parameter not found in notifier.js action URLs"
    return 1
  }
}

test_permission_notification_uses_high_priority() {
  # Permission notifications should be high priority (4)
  grep -q "priority.*4\|4.*priority" "$PLUGIN_DIR/notifier.js" || {
    echo "High priority (4) not found in notifier.js for permission notifications"
    return 1
  }
}

test_permission_notification_has_approve_title() {
  # Title should ask "Approve?" for clarity on iOS notifications
  grep -q "Approve" "$PLUGIN_DIR/notifier.js" || {
    echo "'Approve' not found in permission notification title"
    return 1
  }
}

test_permission_notification_includes_repo_in_title() {
  # Title should include repo/directory name for context
  grep -q "repoName\|repo" "$PLUGIN_DIR/notifier.js" || {
    echo "repo/repoName parameter not used in notifier.js"
    return 1
  }
}

test_permission_notification_includes_command() {
  # Message should include the actual command/pattern, not just description
  grep -q "command\|pattern" "$PLUGIN_DIR/notifier.js" || {
    echo "command/pattern parameter not found in notifier.js"
    return 1
  }
}

test_permission_notification_truncates_long_commands() {
  # Should have truncation logic for long commands
  grep -q "truncate\|slice\|substring\|\.\.\\." "$PLUGIN_DIR/notifier.js" || {
    echo "Command truncation logic not found in notifier.js"
    return 1
  }
}

test_truncate_handles_falsy_input() {
  # truncate() should return empty string for falsy input, not undefined
  grep -q "return ''" "$PLUGIN_DIR/notifier.js" || {
    echo "truncate() should return empty string for falsy input"
    return 1
  }
}

test_permission_notification_clears_on_action() {
  # Actions should clear the notification when clicked
  grep -q "clear.*true\|true.*clear" "$PLUGIN_DIR/notifier.js" || {
    echo "clear: true not found in notifier.js actions"
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
  test_send_notification_logs_errors \
  test_send_notification_supports_auth_token \
  test_send_notification_uses_bearer_auth
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "sendPermissionNotification Function Tests:"

for test_func in \
  test_notifier_exports_send_permission_notification \
  test_permission_notification_includes_actions \
  test_permission_notification_has_allow_once_action \
  test_permission_notification_has_allow_always_action \
  test_permission_notification_has_reject_action \
  test_permission_notification_uses_http_action_type \
  test_permission_notification_uses_callback_url \
  test_permission_notification_includes_nonce \
  test_permission_notification_includes_response_param \
  test_permission_notification_uses_high_priority \
  test_permission_notification_has_approve_title \
  test_permission_notification_includes_repo_in_title \
  test_permission_notification_includes_command \
  test_permission_notification_truncates_long_commands \
  test_truncate_handles_falsy_input \
  test_permission_notification_clears_on_action
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
