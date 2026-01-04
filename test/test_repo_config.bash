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

test_repo_config_supports_prefix_matching() {
  grep -q "prefix\|endsWith.*/" "$SERVICE_DIR/repo-config.js" || {
    echo "Prefix matching not found"
    return 1
  }
}

test_repo_config_merges_configs() {
  grep -q "merge\|deep.*merge" "$SERVICE_DIR/repo-config.js" || {
    echo "Config merging not found"
    return 1
  }
}

test_repo_config_expands_placeholders() {
  grep -q "{repo}\|placeholder" "$SERVICE_DIR/repo-config.js" || {
    echo "Placeholder expansion not found"
    return 1
  }
}

# =============================================================================
# Functional Tests
# =============================================================================

test_repo_config_defaults() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { getRepoConfig } from './service/repo-config.js';
    
    // Get config for non-existent repo should return defaults
    const config = getRepoConfig('nonexistent/repo');
    
    if (!config.wip_limits) {
      console.log('FAIL: Missing wip_limits in defaults');
      process.exit(1);
    }
    if (config.wip_limits.max_concurrent !== 3) {
      console.log('FAIL: Expected default max_concurrent=3, got ' + config.wip_limits.max_concurrent);
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

test_repo_config_prefix_matching() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { loadRepoConfig, getRepoConfig } from './service/repo-config.js';
    
    // Load test config
    const testConfig = {
      repos: {
        'myorg/': {
          repo_path: '~/code/{repo}',
          wip_limits: { max_concurrent: 5 }
        },
        'myorg/backend': {
          wip_limits: { max_concurrent: 2 }
        }
      }
    };
    
    loadRepoConfig(testConfig);
    
    // Get config for myorg/backend - should merge prefix + exact
    const config = getRepoConfig('myorg/backend');
    
    // Should have wip_limits from exact match (2, not 5)
    if (config.wip_limits.max_concurrent !== 2) {
      console.log('FAIL: Expected max_concurrent=2 from exact match, got ' + config.wip_limits.max_concurrent);
      process.exit(1);
    }
    
    // Get config for myorg/frontend - should get prefix config
    const frontendConfig = getRepoConfig('myorg/frontend');
    if (frontendConfig.wip_limits.max_concurrent !== 5) {
      console.log('FAIL: Expected max_concurrent=5 from prefix, got ' + frontendConfig.wip_limits.max_concurrent);
      process.exit(1);
    }
    
    // repo_path should have {repo} expanded
    if (frontendConfig.repo_path !== '~/code/frontend') {
      console.log('FAIL: Expected expanded repo_path, got ' + frontendConfig.repo_path);
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
# Default Sources Tests
# =============================================================================

test_repo_config_default_sources() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { loadRepoConfig, getRepoConfig, getAllSources } from './service/repo-config.js';
    
    // Load config with repo that has no sources specified
    const testConfig = {
      repos: {
        'myorg/': {
          repo_path: '~/code/{repo}'
        },
        'myorg/backend': {}  // No sources specified
      }
    };
    
    loadRepoConfig(testConfig);
    
    // Get config - should have default github_issue source
    const config = getRepoConfig('myorg/backend');
    
    if (!config.sources || config.sources.length === 0) {
      console.log('FAIL: Expected default sources, got empty array');
      process.exit(1);
    }
    
    const defaultSource = config.sources[0];
    if (defaultSource.type !== 'github_issue') {
      console.log('FAIL: Expected default source type github_issue, got ' + defaultSource.type);
      process.exit(1);
    }
    
    if (!defaultSource.fetch || defaultSource.fetch.assignee !== '@me') {
      console.log('FAIL: Expected default fetch.assignee=@me, got ' + JSON.stringify(defaultSource.fetch));
      process.exit(1);
    }
    
    if (!defaultSource.fetch || defaultSource.fetch.state !== 'open') {
      console.log('FAIL: Expected default fetch.state=open, got ' + JSON.stringify(defaultSource.fetch));
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

test_repo_config_explicit_sources_override_defaults() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { loadRepoConfig, getRepoConfig } from './service/repo-config.js';
    
    // Load config with explicit sources
    const testConfig = {
      repos: {
        'myorg/backend': {
          sources: [
            { type: 'github_pr', fetch: { state: 'open' } }
          ]
        }
      }
    };
    
    loadRepoConfig(testConfig);
    
    // Get config - should have explicit sources, not defaults
    const config = getRepoConfig('myorg/backend');
    
    if (config.sources.length !== 1) {
      console.log('FAIL: Expected 1 source, got ' + config.sources.length);
      process.exit(1);
    }
    
    if (config.sources[0].type !== 'github_pr') {
      console.log('FAIL: Expected explicit github_pr source, got ' + config.sources[0].type);
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

test_repo_config_get_all_sources_includes_defaults() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { loadRepoConfig, getAllSources } from './service/repo-config.js';
    
    // Load config with repo that has no sources specified
    const testConfig = {
      repos: {
        'myorg/backend': {
          repo_path: '~/code/backend'
        }
      }
    };
    
    loadRepoConfig(testConfig);
    
    // getAllSources should include the default source
    const sources = getAllSources();
    
    if (sources.length !== 1) {
      console.log('FAIL: Expected 1 source from getAllSources, got ' + sources.length);
      process.exit(1);
    }
    
    if (sources[0].type !== 'github_issue') {
      console.log('FAIL: Expected github_issue source, got ' + sources[0].type);
      process.exit(1);
    }
    
    if (sources[0].repo_key !== 'myorg/backend') {
      console.log('FAIL: Expected repo_key myorg/backend, got ' + sources[0].repo_key);
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
  test_repo_config_supports_prefix_matching \
  test_repo_config_merges_configs \
  test_repo_config_expands_placeholders
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_repo_config_defaults \
  test_repo_config_prefix_matching
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Default Sources Tests:"

for test_func in \
  test_repo_config_default_sources \
  test_repo_config_explicit_sources_override_defaults \
  test_repo_config_get_all_sources_includes_defaults
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
