/**
 * actions.js - Action system for starting sessions
 *
 * Supports two action types:
 * - local: Start OpenCode directly in a directory
 * - container: Use opencode-devcontainers (ocdc) for isolated environment
 */

import { spawn } from "child_process";
import path from "path";
import os from "os";

/**
 * Expand ~ to home directory
 */
function expandPath(p) {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Build session name from template
 * @param {string} template - Template with {placeholders}
 * @param {object} item - Item with fields to substitute
 * @returns {string} Expanded session name
 */
export function buildSessionName(template, item) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return item[key] !== undefined ? String(item[key]) : `{${key}}`;
  });
}

/**
 * Build command args for local action type
 * @returns {string[]} Array of command arguments (safe for spawn)
 */
function buildLocalCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");
  const sessionName = config.session?.name_template
    ? buildSessionName(config.session.name_template, item)
    : `session-${item.number || Date.now()}`;

  // Build opencode command args array (no shell escaping needed)
  const args = ["opencode"];

  // Add directory flag
  args.push("-d", repoPath);

  // Add session name
  args.push("--session", sessionName);

  // Add prompt from issue (safe - passed directly to spawn, not shell)
  const prompt = item.title || item.body || "";
  if (prompt) {
    args.push("--prompt", prompt);
  }

  // Add agent if specified
  if (config.session?.agent) {
    args.push("--agent", config.session.agent);
  }

  return args;
}

/**
 * Build command args for container action type (uses ocdc/opencode-devcontainers)
 * @returns {string[]} Array of command arguments (safe for spawn)
 */
function buildContainerCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");

  // Build ocdc up command args array
  const args = ["ocdc", "up"];

  // Add branch if available
  const branch = item.branch || item.headRefName || item.identifier;
  if (branch) {
    args.push(branch);
  }

  // Add repo path
  args.push("--repo", repoPath);

  // Add JSON flag for machine-readable output
  args.push("--json");

  // Note: ocdc handles session creation internally
  // Additional args can be passed via config.action.devcontainer_args

  if (config.action?.devcontainer_args) {
    args.push(...config.action.devcontainer_args);
  }

  return args;
}

/**
 * Build command args array for an action
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {string[]} Command arguments array (safe for spawn)
 */
export function buildCommandArgs(item, config) {
  const actionType = config.action?.type || "local";

  switch (actionType) {
    case "local":
      return buildLocalCommandArgs(item, config);
    case "container":
      return buildContainerCommandArgs(item, config);
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

/**
 * Build command string for display/logging
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {string} Command string (for display only)
 */
export function buildCommand(item, config) {
  const args = buildCommandArgs(item, config);
  // Quote args with spaces for display
  return args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
}

/**
 * Execute an action
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @param {object} [options] - Execution options
 * @param {boolean} [options.dryRun] - If true, return command without executing
 * @returns {Promise<object>} Result with command, stdout, stderr, exitCode
 */
export async function executeAction(item, config, options = {}) {
  const args = buildCommandArgs(item, config);
  const command = buildCommand(item, config); // For logging/display

  if (options.dryRun) {
    return {
      command,
      dryRun: true,
    };
  }

  return new Promise((resolve, reject) => {
    // Execute directly without shell (safe from injection)
    const [cmd, ...cmdArgs] = args;
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        command,
        stdout,
        stderr,
        exitCode: code,
        success: code === 0,
      });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Check if opencode is available
 * @returns {Promise<boolean>}
 */
export async function checkOpencode() {
  return new Promise((resolve) => {
    const child = spawn("which", ["opencode"]);
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Check if ocdc (opencode-devcontainers) is available
 * @returns {Promise<boolean>}
 */
export async function checkOcdc() {
  return new Promise((resolve) => {
    const child = spawn("which", ["ocdc"]);
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Validate that required tools are available for action type
 * @param {string} actionType - "local" or "container"
 * @returns {Promise<object>} { valid: boolean, missing?: string[] }
 */
export async function validateTools(actionType) {
  const missing = [];

  if (actionType === "local" || actionType === "container") {
    const hasOpencode = await checkOpencode();
    if (!hasOpencode) {
      missing.push("opencode");
    }
  }

  if (actionType === "container") {
    const hasOcdc = await checkOcdc();
    if (!hasOcdc) {
      missing.push("ocdc");
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
