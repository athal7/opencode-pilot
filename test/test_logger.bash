#!/usr/bin/env bash
#
# Tests for logger.js - Optional debug logging module
# Writes to ~/.config/opencode-ntfy/debug.log when enabled
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

PLUGIN_DIR="$(dirname "$SCRIPT_DIR")/plugin"

echo "Testing logger.js module..."
echo ""

# =============================================================================
# File Structure Tests
# =============================================================================

test_logger_file_exists() {
  assert_file_exists "$PLUGIN_DIR/logger.js"
}

test_logger_js_syntax() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  node --check "$PLUGIN_DIR/logger.js" 2>&1 || {
    echo "logger.js has syntax errors"
    return 1
  }
}

# =============================================================================
# Export Tests
# =============================================================================

test_logger_exports_debug() {
  grep -q "export.*function debug\|export.*debug" "$PLUGIN_DIR/logger.js" || {
    echo "debug export not found in logger.js"
    return 1
  }
}

test_logger_exports_init_logger() {
  grep -q "export.*function initLogger\|export.*initLogger" "$PLUGIN_DIR/logger.js" || {
    echo "initLogger export not found in logger.js"
    return 1
  }
}

# =============================================================================
# Implementation Tests
# =============================================================================

test_logger_uses_append_file_sync() {
  # Should use appendFileSync for simplicity (low volume writes)
  grep -q "appendFileSync" "$PLUGIN_DIR/logger.js" || {
    echo "appendFileSync not found in logger.js"
    return 1
  }
}

test_logger_uses_config_dir_by_default() {
  # Default log path should be in ~/.config/opencode-ntfy/
  grep -q "opencode-ntfy\|config.*debug\|debugPath" "$PLUGIN_DIR/logger.js" || {
    echo "Config directory path not found in logger.js"
    return 1
  }
}

test_logger_includes_timestamp() {
  # Log entries should include ISO 8601 timestamp
  grep -q "toISOString\|ISO\|Date\|timestamp" "$PLUGIN_DIR/logger.js" || {
    echo "Timestamp formatting not found in logger.js"
    return 1
  }
}

test_logger_has_rotation_logic() {
  # Should have log rotation or size limiting
  grep -q "rotate\|size\|maxSize\|MAX_SIZE\|truncate\|unlink" "$PLUGIN_DIR/logger.js" || {
    echo "Log rotation logic not found in logger.js"
    return 1
  }
}

test_logger_checks_enabled_flag() {
  # Should check if debug mode is enabled before writing
  grep -q "enabled\|isEnabled\|debugEnabled" "$PLUGIN_DIR/logger.js" || {
    echo "Enabled flag check not found in logger.js"
    return 1
  }
}

test_logger_handles_errors_silently() {
  # Should catch errors to avoid crashing the plugin
  grep -q "catch\|try" "$PLUGIN_DIR/logger.js" || {
    echo "Error handling not found in logger.js"
    return 1
  }
}

test_logger_no_console_output() {
  # Should not use console.log (interferes with TUI)
  if grep -q 'console\.log\|console\.error\|console\.warn' "$PLUGIN_DIR/logger.js"; then
    echo "Console output found - should be silent"
    return 1
  fi
}

test_logger_creates_directory_if_missing() {
  # Should create log directory if it doesn't exist
  grep -q "mkdirSync\|mkdir" "$PLUGIN_DIR/logger.js" || {
    echo "Directory creation not found in logger.js"
    return 1
  }
}

# =============================================================================
# Functional Tests (requires Node.js)
# =============================================================================

test_logger_disabled_by_default() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { debug, initLogger } from './plugin/logger.js';
    
    // Initialize without debug enabled
    initLogger({ debug: false });
    
    // debug() should be a no-op when disabled
    debug('test message');
    
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

test_logger_writes_when_enabled() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local test_dir
  test_dir=$(mktemp -d)
  local log_file="$test_dir/debug.log"
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { debug, initLogger } from './plugin/logger.js';
    import { existsSync, readFileSync } from 'fs';
    
    // Initialize with debug enabled and custom path
    initLogger({ debug: true, debugPath: '$log_file' });
    
    // Write a test message
    debug('test message');
    
    // Verify file was created and contains message
    if (!existsSync('$log_file')) {
      console.log('FAIL: Log file not created');
      process.exit(1);
    }
    
    const content = readFileSync('$log_file', 'utf8');
    if (!content.includes('test message')) {
      console.log('FAIL: Log file does not contain message');
      console.log('Content:', content);
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1)
  local exit_code=$?
  
  # Cleanup
  rm -rf "$test_dir"
  
  if [[ $exit_code -ne 0 ]]; then
    echo "Functional test failed: $result"
    return 1
  fi
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_logger_includes_timestamp_in_output() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local test_dir
  test_dir=$(mktemp -d)
  local log_file="$test_dir/debug.log"
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { debug, initLogger } from './plugin/logger.js';
    import { readFileSync } from 'fs';
    
    initLogger({ debug: true, debugPath: '$log_file' });
    debug('test message');
    
    const content = readFileSync('$log_file', 'utf8');
    
    // Should have ISO 8601 timestamp format: [2025-01-02T12:00:00.000Z]
    if (!/\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(content)) {
      console.log('FAIL: Timestamp not in expected format');
      console.log('Content:', content);
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1)
  local exit_code=$?
  
  rm -rf "$test_dir"
  
  if [[ $exit_code -ne 0 ]]; then
    echo "Functional test failed: $result"
    return 1
  fi
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_logger_rotates_large_files() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local test_dir
  test_dir=$(mktemp -d)
  local log_file="$test_dir/debug.log"
  
  local result
  result=$(node --experimental-vm-modules -e "
    import { debug, initLogger, MAX_LOG_SIZE } from './plugin/logger.js';
    import { writeFileSync, statSync, existsSync } from 'fs';
    
    initLogger({ debug: true, debugPath: '$log_file' });
    
    // Create a file larger than MAX_LOG_SIZE
    // Write more than the max size to trigger rotation
    const largeContent = 'x'.repeat(MAX_LOG_SIZE + 1000);
    writeFileSync('$log_file', largeContent);
    
    // This write should trigger rotation
    debug('after rotation');
    
    const stats = statSync('$log_file');
    
    // File should be smaller than the large content we wrote
    // (rotation should have cleared/truncated it)
    if (stats.size >= largeContent.length) {
      console.log('FAIL: File was not rotated, size:', stats.size);
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1)
  local exit_code=$?
  
  rm -rf "$test_dir"
  
  if [[ $exit_code -ne 0 ]]; then
    echo "Functional test failed: $result"
    return 1
  fi
  
  if ! echo "$result" | grep -q "PASS"; then
    echo "$result"
    return 1
  fi
}

test_logger_respects_env_var() {
  if ! command -v node &>/dev/null; then
    echo "SKIP: node not available"
    return 0
  fi
  
  local test_dir
  test_dir=$(mktemp -d)
  local log_file="$test_dir/debug.log"
  
  local result
  result=$(NTFY_DEBUG=true NTFY_DEBUG_PATH="$log_file" node --experimental-vm-modules -e "
    import { debug, initLogger } from './plugin/logger.js';
    import { existsSync, readFileSync } from 'fs';
    
    // Initialize from environment (no explicit config)
    initLogger({});
    
    debug('env var test');
    
    if (!existsSync('$log_file')) {
      console.log('FAIL: Log file not created from env var');
      process.exit(1);
    }
    
    const content = readFileSync('$log_file', 'utf8');
    if (!content.includes('env var test')) {
      console.log('FAIL: Message not written');
      process.exit(1);
    }
    
    console.log('PASS');
  " 2>&1)
  local exit_code=$?
  
  rm -rf "$test_dir"
  
  if [[ $exit_code -ne 0 ]]; then
    echo "Functional test failed: $result"
    return 1
  fi
  
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
  test_logger_file_exists \
  test_logger_js_syntax
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Export Tests:"

for test_func in \
  test_logger_exports_debug \
  test_logger_exports_init_logger
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Implementation Tests:"

for test_func in \
  test_logger_uses_append_file_sync \
  test_logger_uses_config_dir_by_default \
  test_logger_includes_timestamp \
  test_logger_has_rotation_logic \
  test_logger_checks_enabled_flag \
  test_logger_handles_errors_silently \
  test_logger_no_console_output \
  test_logger_creates_directory_if_missing
do
  run_test "${test_func#test_}" "$test_func"
done

echo ""
echo "Functional Tests:"

for test_func in \
  test_logger_disabled_by_default \
  test_logger_writes_when_enabled \
  test_logger_includes_timestamp_in_output \
  test_logger_rotates_large_files \
  test_logger_respects_env_var
do
  run_test "${test_func#test_}" "$test_func"
done

print_summary
