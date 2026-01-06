#!/usr/bin/env bash
#
# Tests for repo-config.js - Unified repository configuration
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing repo-config.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_repo_config_file_exists() {
  assert_file_exists "$SERVICE_DIR/repo-config.js"
}

test_repo_config_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/repo-config.js" 2>&1 || {
    echo "repo-config.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_repo_config_exports_load_config() {
  grep -q "export.*function loadRepoConfig\|export.*loadRepoConfig" "$SERVICE_DIR/repo-config.js" || {
    echo "loadRepoConfig export not found"
    return 1
  }
}

test_repo_config_exports_get_config() {
  grep -q "export.*function getRepoConfig\|export.*getRepoConfig" "$SERVICE_DIR/repo-config.js" || {
    echo "getRepoConfig export not found"
    return 1
  }
}

test_repo_config_exports_get_all_sources() {
  grep -q "export.*function getAllSources\|export.*getAllSources" "$SERVICE_DIR/repo-config.js" || {
    echo "getAllSources export not found"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_repo_config_supports_yaml() {
  grep -q "yaml\|YAML" "$SERVICE_DIR/repo-config.js" || {
    echo "YAML support not found"
    return 1
  }
}

test_repo_config_supports_source_config() {
  grep -q "sources" "$SERVICE_DIR/repo-config.js" || {
    echo "Sources support not found"
    return 1
  }
}

test_repo_config_supports_tool_mappings() {
  grep -q "mappings\|tools" "$SERVICE_DIR/repo-config.js" || {
    echo "Tool mappings support not found"
    return 1
  }
}

# =============================================================================
# Functional Tests
# =============================================================================

test_repo_config_returns_empty_for_unknown_repo() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { getRepoConfig } from './service/repo-config.js';
    
    // Get config for non-existent repo should return empty object
    const config = getRepoConfig('nonexistent/repo');
    
    if (typeof config !== 'object') {
      console.log('FAIL: Expected object for unknown repo');
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

test_repo_config_gets_sources() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { getAllSources } from './service/repo-config.js';
    
    // getAllSources should return an array
    const sources = getAllSources();
    
    if (!Array.isArray(sources)) {
      console.log('FAIL: Expected array from getAllSources');
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
  test_repo_config_file_exists \
  test_repo_config_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_repo_config_exports_load_config \
  test_repo_config_exports_get_config \
  test_repo_config_exports_get_all_sources
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_repo_config_supports_yaml \
  test_repo_config_supports_source_config \
  test_repo_config_supports_tool_mappings
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_repo_config_returns_empty_for_unknown_repo \
  test_repo_config_gets_sources
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
