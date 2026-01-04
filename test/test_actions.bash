#!/usr/bin/env bash
#
# Tests for actions.js - Action system for starting sessions
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing actions.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_actions_file_exists() {
  assert_file_exists "$SERVICE_DIR/actions.js"
}

test_actions_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/actions.js" 2>&1 || {
    echo "actions.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_actions_exports_execute_action() {
  grep -q "export.*function executeAction\|export.*executeAction" "$SERVICE_DIR/actions.js" || {
    echo "executeAction export not found"
    return 1
  }
}

test_actions_exports_build_command() {
  grep -q "export.*function buildCommand\|export.*buildCommand" "$SERVICE_DIR/actions.js" || {
    echo "buildCommand export not found"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_actions_supports_local_type() {
  grep -q "local" "$SERVICE_DIR/actions.js" || {
    echo "Local action type not found"
    return 1
  }
}

test_actions_supports_container_type() {
  grep -q "container" "$SERVICE_DIR/actions.js" || {
    echo "Container action type not found"
    return 1
  }
}

test_actions_calls_opencode() {
  grep -q "opencode" "$SERVICE_DIR/actions.js" || {
    echo "OpenCode invocation not found"
    return 1
  }
}

test_actions_calls_devcontainer() {
  grep -q "devcontainer" "$SERVICE_DIR/actions.js" || {
    echo "devcontainer CLI invocation not found"
    return 1
  }
}

# =============================================================================
# Functional Tests
# =============================================================================

test_actions_build_local_command() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { buildCommand } from './service/actions.js';
    
    const item = {
      title: 'Fix bug #123',
      html_url: 'https://github.com/org/repo/issues/123',
      number: 123
    };
    
    const config = {
      repo_path: '~/code/myrepo',
      action: { type: 'local' },
      session: { name_template: 'issue-{number}' }
    };
    
    const cmd = buildCommand(item, config);
    
    if (!cmd.includes('opencode run')) {
      console.log('FAIL: Local command should include opencode run');
      process.exit(1);
    }
    // Check for cwd pattern (cd ~/code/myrepo && ...)
    if (!cmd.includes('cd') || !cmd.includes('myrepo')) {
      console.log('FAIL: Command should include cd to repo path, got: ' + cmd);
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

test_actions_build_container_command() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { buildCommand } from './service/actions.js';
    
    const item = {
      title: 'Fix bug #123',
      html_url: 'https://github.com/org/repo/issues/123',
      number: 123,
      branch: 'fix-123'
    };
    
    const config = {
      repo_path: '~/code/myrepo',
      action: { type: 'container' },
      session: { name_template: 'issue-{number}' }
    };
    
    const cmd = buildCommand(item, config);
    
    if (!cmd.includes('ocdc') && !cmd.includes('devcontainer')) {
      console.log('FAIL: Container command should include ocdc or devcontainer');
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

test_actions_session_name_template() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { buildSessionName } from './service/actions.js';
    
    const item = {
      number: 42,
      repo_key: 'myorg/backend',
      repo_short: 'backend'
    };
    
    const template = 'issue-{repo_short}-{number}';
    const name = buildSessionName(template, item);
    
    if (name !== 'issue-backend-42') {
      console.log('FAIL: Expected issue-backend-42, got ' + name);
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
  test_actions_file_exists \
  test_actions_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_actions_exports_execute_action \
  test_actions_exports_build_command
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_actions_supports_local_type \
  test_actions_supports_container_type \
  test_actions_calls_opencode \
  test_actions_calls_devcontainer
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_actions_build_local_command \
  test_actions_build_container_command \
  test_actions_session_name_template
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
