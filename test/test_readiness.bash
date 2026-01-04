#!/usr/bin/env bash
#
# Tests for readiness.js - Issue readiness evaluation for self-iteration
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

SERVICE_DIR="$(dirname "$SCRIPT_DIR")/service"

echo "Testing readiness.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_readiness_file_exists() {
  assert_file_exists "$SERVICE_DIR/readiness.js"
}

test_readiness_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$SERVICE_DIR/readiness.js" 2>&1 || {
    echo "readiness.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_readiness_exports_evaluate() {
  grep -q "export.*function evaluateReadiness\|export.*evaluateReadiness" "$SERVICE_DIR/readiness.js" || {
    echo "evaluateReadiness export not found"
    return 1
  }
}

test_readiness_exports_check_labels() {
  grep -q "export.*function checkLabels\|export.*checkLabels" "$SERVICE_DIR/readiness.js" || {
    echo "checkLabels export not found"
    return 1
  }
}

test_readiness_exports_check_dependencies() {
  grep -q "export.*function checkDependencies\|export.*checkDependencies" "$SERVICE_DIR/readiness.js" || {
    echo "checkDependencies export not found"
    return 1
  }
}

test_readiness_exports_calculate_priority() {
  grep -q "export.*function calculatePriority\|export.*calculatePriority" "$SERVICE_DIR/readiness.js" || {
    echo "calculatePriority export not found"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_readiness_checks_blocking_labels() {
  grep -q "block\|exclude" "$SERVICE_DIR/readiness.js" || {
    echo "Blocking label check not found"
    return 1
  }
}

test_readiness_checks_body_references() {
  grep -q "blocked by\|depends on\|body" "$SERVICE_DIR/readiness.js" || {
    echo "Body reference check not found"
    return 1
  }
}

test_readiness_calculates_priority_score() {
  grep -q "priority\|score\|weight" "$SERVICE_DIR/readiness.js" || {
    echo "Priority calculation not found"
    return 1
  }
}

# =============================================================================
# Functional Tests
# =============================================================================

test_readiness_blocked_by_label() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { checkLabels } from './service/readiness.js';
    
    const issue = {
      labels: [{ name: 'blocked' }, { name: 'bug' }]
    };
    
    const config = {
      readiness: {
        labels: {
          exclude: ['blocked', 'wontfix']
        }
      }
    };
    
    const result = checkLabels(issue, config);
    
    if (result.ready !== false) {
      console.log('FAIL: Issue with blocked label should not be ready');
      process.exit(1);
    }
    if (!result.reason.includes('blocked')) {
      console.log('FAIL: Reason should mention blocked label');
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

test_readiness_passes_without_blocking_labels() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { checkLabels } from './service/readiness.js';
    
    const issue = {
      labels: [{ name: 'enhancement' }, { name: 'good first issue' }]
    };
    
    const config = {
      readiness: {
        labels: {
          exclude: ['blocked', 'wontfix']
        }
      }
    };
    
    const result = checkLabels(issue, config);
    
    if (result.ready !== true) {
      console.log('FAIL: Issue without blocked labels should be ready');
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

test_readiness_blocked_by_dependency() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { checkDependencies } from './service/readiness.js';
    
    const issue = {
      body: 'This feature is blocked by #123 which needs to be done first.'
    };
    
    const config = {
      readiness: {
        dependencies: {
          check_body_references: true
        }
      }
    };
    
    const result = checkDependencies(issue, config);
    
    if (result.ready !== false) {
      console.log('FAIL: Issue with dependency reference should not be ready');
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

test_readiness_priority_calculation() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { calculatePriority } from './service/readiness.js';
    
    const issue = {
      labels: [{ name: 'critical' }, { name: 'bug' }],
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days old
    };
    
    const config = {
      readiness: {
        priority: {
          labels: [
            { label: 'critical', weight: 100 },
            { label: 'high', weight: 50 }
          ],
          age_weight: 1
        }
      }
    };
    
    const score = calculatePriority(issue, config);
    
    if (score < 100) {
      console.log('FAIL: Critical issue should have score >= 100, got ' + score);
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
  test_readiness_file_exists \
  test_readiness_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_readiness_exports_evaluate \
  test_readiness_exports_check_labels \
  test_readiness_exports_check_dependencies \
  test_readiness_exports_calculate_priority
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_readiness_checks_blocking_labels \
  test_readiness_checks_body_references \
  test_readiness_calculates_priority_score
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_readiness_blocked_by_label \
  test_readiness_passes_without_blocking_labels \
  test_readiness_blocked_by_dependency \
  test_readiness_priority_calculation
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
