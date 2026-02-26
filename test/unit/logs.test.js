/**
 * Tests for the `logs` CLI command.
 *
 * The command prints the debug log path and optionally tails/follows it.
 * Flags:
 *   --path     Print only the log file path
 *   --lines N  Print last N lines (default 50)
 *   --follow   Follow the log file (tail -f)
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, "..", "..", "bin", "opencode-pilot");

// Helper: run opencode-pilot with overridden log path via env
function runLogs(args = [], env = {}) {
  return spawnSync(process.execPath, [CLI, "logs", ...args], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, ...env },
  });
}

describe("logs command", () => {
  let tmpDir;
  let logFile;

  // Create a temp log file for each test group
  function setupLogFile(lines = []) {
    tmpDir = join(tmpdir(), `opencode-pilot-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    logFile = join(tmpDir, "debug.log");
    if (lines.length) {
      writeFileSync(logFile, lines.join("\n") + "\n");
    }
    return logFile;
  }

  function cleanup() {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  describe("--path flag", () => {
    test("prints the log file path", () => {
      const path = setupLogFile();
      const result = runLogs(["--path"], { PILOT_LOG_PATH: path });
      cleanup();
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout.trim(), /debug\.log/);
    });

    test("prints path even when log file does not exist", () => {
      const nonExistentPath = join(tmpdir(), "no-such-dir", "debug.log");
      const result = runLogs(["--path"], { PILOT_LOG_PATH: nonExistentPath });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout.trim(), /debug\.log/);
    });
  });

  describe("default output (last N lines)", () => {
    test("prints last 50 lines by default when log exists", () => {
      const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
      const path = setupLogFile(lines);
      const result = runLogs([], { PILOT_LOG_PATH: path });
      cleanup();
      assert.strictEqual(result.status, 0);
      // Should contain lines 11-60 (last 50)
      assert.match(result.stdout, /line 60/);
      // Lines 1-10 should be excluded (only last 50 of 60 are shown)
      assert.doesNotMatch(result.stdout, /^line [1-9]\b/m);
    });

    test("--lines N prints last N lines", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `entry ${i + 1}`);
      const path = setupLogFile(lines);
      const result = runLogs(["--lines", "5"], { PILOT_LOG_PATH: path });
      cleanup();
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /entry 20/);
      assert.doesNotMatch(result.stdout, /entry 1\n/);
    });

    test("exits 0 with informational message when log does not exist", () => {
      const nonExistentPath = join(
        tmpdir(),
        `no-log-${Date.now()}`,
        "debug.log"
      );
      const result = runLogs([], { PILOT_LOG_PATH: nonExistentPath });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /no log/i);
    });
  });

  describe("help text", () => {
    test("opencode-pilot help includes logs command", () => {
      const result = spawnSync(process.execPath, [CLI, "help"], {
        encoding: "utf8",
        timeout: 5000,
      });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /logs/);
    });
  });
});
