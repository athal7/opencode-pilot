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

test_actions_uses_opencode_run() {
  grep -q "opencode.*run" "$SERVICE_DIR/actions.js" || {
    echo "opencode run command not found"
    return 1
  }
}

test_actions_prompt_template() {
  grep -q "prompt_template\|promptTemplate" "$SERVICE_DIR/actions.js" || {
    echo "Prompt template support not found"
    return 1
  }
}

test_actions_calls_opencode() {
  grep -q "opencode" "$SERVICE_DIR/actions.js" || {
    echo "OpenCode invocation not found"
    return 1
  }
}

test_actions_builds_prompt_from_item() {
  grep -q "title\|body" "$SERVICE_DIR/actions.js" || {
    echo "Prompt building from item not found"
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

test_actions_prompt_template_expansion() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { buildCommand } from './service/actions.js';
    
    const item = {
      title: 'Fix bug',
      body: 'Details here',
      number: 456
    };
    
    // Config with custom prompt template (e.g., for devcontainer)
    const config = {
      repo_path: '~/code/myrepo',
      session: { 
        name_template: 'issue-{number}',
        prompt_template: '/devcontainer issue-{number}\n\n{title}\n\n{body}'
      }
    };
    
    const cmd = buildCommand(item, config);
    
    // Should include the expanded template
    if (!cmd.includes('/devcontainer issue-456')) {
      console.log('FAIL: Command should include expanded prompt template');
      console.log('Got: ' + cmd);
      process.exit(1);
    }
    if (!cmd.includes('Fix bug')) {
      console.log('FAIL: Command should include title from template');
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
  test_actions_uses_opencode_run \
  test_actions_prompt_template \
  test_actions_calls_opencode \
  test_actions_builds_prompt_from_item
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_actions_build_local_command \
  test_actions_prompt_template_expansion \
  test_actions_session_name_template
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
