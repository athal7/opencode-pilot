#!/usr/bin/env bash
#
# Tests for service/server.js - Standalone callback server as brew service
# Issue #13: Separate callback server as brew service
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing service/server.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_service_file_exists() {
  assert_file_exists "$SERVICE_DIR/server.js"
}

test_service_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/server.js" 2>&1 || {
    echo "server.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_service_exports_start_service() {
  grep -q "export.*function startService\|export.*startService" "$SERVICE_DIR/server.js" || {
    echo "startService export not found in server.js"
    return 1
  }
}

test_service_exports_stop_service() {
  grep -q "export.*function stopService\|export.*stopService" "$SERVICE_DIR/server.js" || {
    echo "stopService export not found in server.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_service_has_http_server() {
  grep -q "createServer\|http" "$SERVICE_DIR/server.js" || {
    echo "HTTP server not found in server.js"
    return 1
  }
}

test_service_has_unix_socket() {
  grep -q "createServer\|net\|\.sock\|socket" "$SERVICE_DIR/server.js" || {
    echo "Unix socket handling not found in server.js"
    return 1
  }
}

test_service_has_health_endpoint() {
  grep -q "/health" "$SERVICE_DIR/server.js" || {
    echo "/health endpoint not found in server.js"
    return 1
  }
}

test_service_has_callback_endpoint() {
  grep -q "/callback" "$SERVICE_DIR/server.js" || {
    echo "/callback endpoint not found in server.js"
    return 1
  }
}

test_service_handles_session_registration() {
  grep -q "register\|session" "$SERVICE_DIR/server.js" || {
    echo "Session registration not found in server.js"
    return 1
  }
}

test_service_handles_nonce_creation() {
  grep -q "createNonce\|nonce" "$SERVICE_DIR/server.js" || {
    echo "Nonce creation not found in server.js"
    return 1
  }
}

test_service_logs_with_prefix() {
  grep -q "\[opencode-ntfy\]" "$SERVICE_DIR/server.js" || {
    echo "Logging prefix [opencode-ntfy] not found in server.js"
    return 1
  }
}



# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_service_starts_and_stops() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    // Use random ports/sockets to avoid conflicts
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    
    if (!service.httpServer) {
      console.log('FAIL: HTTP server not started');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_health_endpoint_returns_200() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/health');
    
    if (res.status !== 200) {
      console.log('FAIL: Health check returned ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_returns_401_for_invalid_nonce() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/callback?nonce=invalid&response=once', {
      method: 'POST'
    });
    
    if (res.status !== 401) {
      console.log('FAIL: Expected 401, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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
# Mobile UI Tests
# =============================================================================

test_service_has_mobile_session_route() {
  grep -q "/m/" "$SERVICE_DIR/server.js" || {
    echo "Mobile session route /m/ not found in server.js"
    return 1
  }
}

test_service_has_api_session_route() {
  grep -q "/api/" "$SERVICE_DIR/server.js" || {
    echo "API proxy route /api/ not found in server.js"
    return 1
  }
}

test_service_mobile_page_returns_html() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123');
    
    if (res.status !== 200) {
      console.log('FAIL: Mobile page returned ' + res.status);
      process.exit(1);
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      console.log('FAIL: Expected text/html, got ' + contentType);
      process.exit(1);
    }
    
    const html = await res.text();
    if (!html.includes('<!DOCTYPE html>')) {
      console.log('FAIL: Response is not valid HTML');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_mobile_page_has_text_input() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123');
    const html = await res.text();
    
    // Check for text input and send button
    if (!html.includes('<textarea') && !html.includes('<input')) {
      console.log('FAIL: No text input found in mobile page');
      process.exit(1);
    }
    
    if (!html.includes('Send') && !html.includes('send')) {
      console.log('FAIL: No send button found in mobile page');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_api_session_proxies_get() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  # This test verifies the route exists and attempts to proxy GET requests
  # We use a random high port that's unlikely to have a server running
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Use a random high port (59999) that's very unlikely to have a server
    const res = await fetch('http://localhost:' + port + '/api/59999/session/ses_123');
    
    // We expect 502 Bad Gateway since there's no server on port 59999
    // The important thing is the route exists and attempts to proxy (not 404)
    if (res.status !== 502) {
      console.log('FAIL: Expected 502 (proxy target unavailable), got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_api_chat_proxies_post() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Use a random high port (59999) that's very unlikely to have a server
    const res = await fetch('http://localhost:' + port + '/api/59999/session/ses_123/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' })
    });
    
    // We expect 502 Bad Gateway since there's no server on port 59999
    if (res.status !== 502) {
      console.log('FAIL: Expected 502 (proxy target unavailable), got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_mobile_ui_fetches_messages_endpoint() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123');
    const html = await res.text();
    
    // The mobile UI JavaScript should fetch from /message endpoint, not expect messages in session
    // This is critical: messages are at /session/:id/message, not embedded in /session/:id
    if (!html.includes('/message')) {
      console.log('FAIL: Mobile UI should fetch from /message endpoint');
      process.exit(1);
    }
    
    // Should NOT rely on session.messages (which doesn't exist in OpenCode API)
    // The loadSession function should fetch messages separately
    if (html.includes('session.messages')) {
      console.log('FAIL: Mobile UI should not use session.messages (it does not exist in API)');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_mobile_ui_parses_message_info_role() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123');
    const html = await res.text();
    
    // The mobile UI should look for role in message.info.role (OpenCode structure)
    // not message.role (which doesn't exist at top level)
    if (!html.includes('.info.role') && !html.includes('info\"].role')) {
      console.log('FAIL: Mobile UI should access role via message.info.role');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_mobile_ui_fetches_session_title() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Include X-Forwarded-Proto header to bypass HTTPS redirect in test
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123', {
      headers: { 'X-Forwarded-Proto': 'https' }
    });
    const html = await res.text();
    
    // The mobile UI should fetch session info to get the autogenerated title
    // This requires fetching from /session/:id endpoint and displaying the title
    if (!html.includes('loadSessionInfo') || !html.includes('sessionTitle')) {
      console.log('FAIL: Mobile UI should fetch and display session title');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_mobile_ui_shows_conversation_history() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Include X-Forwarded-Proto header to bypass HTTPS redirect in test
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123', {
      headers: { 'X-Forwarded-Proto': 'https' }
    });
    const html = await res.text();
    
    // The mobile UI should display multiple messages from conversation history
    // Look for a container that shows all messages and the renderMessages function
    if (!html.includes('renderMessages') || !html.includes('messages-list')) {
      console.log('FAIL: Mobile UI should have renderMessages function AND messages-list container for conversation history');
      process.exit(1);
    }
    
    await stopService(service);
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
# Security Tests
# =============================================================================

test_service_rejects_privileged_ports() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Try to proxy to port 22 (SSH) - should be rejected
    const res = await fetch('http://localhost:' + port + '/api/22/session/ses_123');
    
    // Expect 400 Bad Request for invalid port, not 502 (which would mean it tried to connect)
    if (res.status !== 400) {
      console.log('FAIL: Expected 400 for privileged port, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_rejects_low_ports() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Try to proxy to port 80 (HTTP) - should be rejected as it's below 1024
    const res = await fetch('http://localhost:' + port + '/api/80/session/ses_123');
    
    if (res.status !== 400) {
      console.log('FAIL: Expected 400 for low port, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_escapes_html_in_reponame() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Try XSS via repo name
    const xssPayload = encodeURIComponent('<script>alert(1)</script>');
    const res = await fetch('http://localhost:' + port + '/m/4096/' + xssPayload + '/session/ses_123');
    const html = await res.text();
    
    // The script tag should be escaped, not raw
    if (html.includes('<script>alert(1)</script>')) {
      console.log('FAIL: XSS payload was not escaped in HTML');
      process.exit(1);
    }
    
    // Should contain escaped version
    if (!html.includes('&lt;script&gt;') && !html.includes('\\\\u003c')) {
      console.log('FAIL: Expected escaped script tag');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_markdown_renderer_escapes_xss() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/m/4096/myrepo/session/ses_123');
    const html = await res.text();
    
    // Extract the renderMarkdown function and test it
    // The function should escape HTML before applying markdown
    // We verify by checking the escapeHtml is called before regex replacements
    
    // Check that escapeHtml is defined and called first in renderMarkdown
    if (!html.includes('function escapeHtml')) {
      console.log('FAIL: escapeHtml function not found');
      process.exit(1);
    }
    
    if (!html.includes('function renderMarkdown')) {
      console.log('FAIL: renderMarkdown function not found');
      process.exit(1);
    }
    
    // Verify escapeHtml is called at the start of renderMarkdown
    // The pattern should be: escapeHtml(text) before any .replace() calls
    const renderMarkdownMatch = html.match(/function renderMarkdown[\\s\\S]*?escapeHtml\\(text\\)/);
    if (!renderMarkdownMatch) {
      console.log('FAIL: renderMarkdown should call escapeHtml(text) before processing');
      process.exit(1);
    }
    
    // Verify the escapeHtml function uses safe DOM-based escaping
    if (!html.includes('textContent') || !html.includes('innerHTML')) {
      console.log('FAIL: escapeHtml should use DOM-based escaping (textContent -> innerHTML)');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_handles_cors_preflight() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Send OPTIONS preflight request
    const res = await fetch('http://localhost:' + port + '/api/4096/session/ses_123', {
      method: 'OPTIONS'
    });
    
    if (res.status !== 204) {
      console.log('FAIL: Expected 204 for OPTIONS, got ' + res.status);
      process.exit(1);
    }
    
    const allowOrigin = res.headers.get('access-control-allow-origin');
    if (allowOrigin !== '*') {
      console.log('FAIL: Expected Access-Control-Allow-Origin: *, got ' + allowOrigin);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_page_exists() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // New session page should be at /new
    const res = await fetch('http://localhost:' + port + '/new');
    
    if (res.status !== 200) {
      console.log('FAIL: New session page returned ' + res.status);
      process.exit(1);
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      console.log('FAIL: Expected text/html, got ' + contentType);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_page_has_directory_selector() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/new');
    const html = await res.text();
    
    // Should have directory selector (select element or similar)
    if (!html.includes('directory') && !html.includes('project')) {
      console.log('FAIL: No directory/project selector found');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_page_has_agent_selector() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/new');
    const html = await res.text();
    
    // Should have agent selector
    if (!html.includes('agent')) {
      console.log('FAIL: No agent selector found');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_page_has_message_input() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    const res = await fetch('http://localhost:' + port + '/new');
    const html = await res.text();
    
    // Should have text input for message
    if (!html.includes('<textarea')) {
      console.log('FAIL: No textarea found for message input');
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_api_proxies_projects() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Use port 59999 which won't have a server
    const res = await fetch('http://localhost:' + port + '/api/59999/project');
    
    // Expect 502 since no server on that port
    if (res.status !== 502) {
      console.log('FAIL: Expected 502, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_new_session_api_proxies_agents() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Use port 59999 which won't have a server
    const res = await fetch('http://localhost:' + port + '/api/59999/agent');
    
    // Expect 502 since no server on that port
    if (res.status !== 502) {
      console.log('FAIL: Expected 502, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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

test_service_rejects_large_request_body() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { startService, stopService } from './service/server.js';
    
    const config = {
      httpPort: 0,
      socketPath: '/tmp/opencode-ntfy-test-' + process.pid + '.sock'
    };
    
    const service = await startService(config);
    const port = service.httpServer.address().port;
    
    // Send a 2MB body (should be rejected if limit is 1MB)
    const largeBody = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch('http://localhost:' + port + '/api/4096/session/ses_123/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: largeBody })
    });
    
    if (res.status !== 413) {
      console.log('FAIL: Expected 413 for large body, got ' + res.status);
      process.exit(1);
    }
    
    await stopService(service);
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
  test_service_file_exists \
  test_service_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_service_exports_start_service \
  test_service_exports_stop_service
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_service_has_http_server \
  test_service_has_unix_socket \
  test_service_has_health_endpoint \
  test_service_has_callback_endpoint \
  test_service_handles_session_registration \
  test_service_handles_nonce_creation \
  test_service_logs_with_prefix
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_service_starts_and_stops \
  test_service_health_endpoint_returns_200 \
  test_service_returns_401_for_invalid_nonce
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Mobile UI Tests:"

for test_func in \
  test_service_has_mobile_session_route \
  test_service_has_api_session_route \
  test_service_mobile_page_returns_html \
  test_service_mobile_page_has_text_input \
  test_service_api_session_proxies_get \
  test_service_api_chat_proxies_post \
  test_service_mobile_ui_fetches_messages_endpoint \
  test_service_mobile_ui_parses_message_info_role \
  test_service_mobile_ui_fetches_session_title \
  test_service_mobile_ui_shows_conversation_history
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Security Tests:"

for test_func in \
  test_service_rejects_privileged_ports \
  test_service_rejects_low_ports \
  test_service_escapes_html_in_reponame \
  test_service_markdown_renderer_escapes_xss \
  test_service_handles_cors_preflight \
  test_service_rejects_large_request_body
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "New Session Page Tests:"

for test_func in \
  test_service_new_session_page_exists \
  test_service_new_session_page_has_directory_selector \
  test_service_new_session_page_has_agent_selector \
  test_service_new_session_page_has_message_input \
  test_service_new_session_api_proxies_projects \
  test_service_new_session_api_proxies_agents
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
