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
 * Uses "opencode run" for non-interactive execution
 * @returns {object} { args: string[], cwd: string }
 */
function buildLocalCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");
  const sessionName = config.session?.name_template
    ? buildSessionName(config.session.name_template, item)
    : `issue-${item.number || Date.now()}`;

  // Build opencode run command args array (non-interactive)
  // Note: opencode run doesn't accept -d flag, so we use cwd
  const args = ["opencode", "run"];

  // Add session name
  args.push("--session", sessionName);

  // Add agent if specified
  if (config.session?.agent) {
    args.push("--agent", config.session.agent);
  }

  // Add prompt from issue as the message (must be last for "run" command)
  const prompt = item.title || item.body || "";
  if (prompt) {
    args.push(prompt);
  }

  return { args, cwd: repoPath };
}

/**
 * Build command args for container action type (uses ocdc/opencode-devcontainers)
 * Container action is a two-step process:
 * 1. ocdc up <branch> - Start the devcontainer
 * 2. ocdc exec -- opencode --session <name> --prompt "<issue>" - Start opencode inside
 * 
 * @returns {object} { upArgs: string[], execArgs: string[], cwd: string, sessionName: string }
 */
function buildContainerCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");

  // Session name - use session template or default to issue-{number}
  const sessionName = config.session?.name_template
    ? buildSessionName(config.session.name_template, item)
    : `issue-${item.number || Date.now()}`;

  // Step 1: ocdc up command
  // --no-open prevents VS Code from opening (we just want container running)
  const upArgs = ["ocdc", "up", sessionName, "--no-open", "--json"];
  if (config.action?.devcontainer_args) {
    upArgs.push(...config.action.devcontainer_args);
  }

  // Step 2: ocdc exec command to start opencode
  // Use "opencode run" for non-interactive execution
  // We'll fill in --workspace after getting output from step 1
  const execArgs = ["ocdc", "exec", "--json", "--"];
  execArgs.push("opencode", "run");
  execArgs.push("--session", sessionName);
  
  // Add agent if specified
  if (config.session?.agent) {
    execArgs.push("--agent", config.session.agent);
  }

  // Add prompt from issue as the message
  const prompt = item.title || item.body || "";
  if (prompt) {
    execArgs.push(prompt);
  }

  return { upArgs, execArgs, cwd: repoPath, sessionName };
}

/**
 * Build command args array for an action
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {object} Command arguments - structure depends on action type
 *   - local: { args: string[], type: 'local' }
 *   - container: { upArgs: string[], execArgs: string[], cwd: string, sessionName: string, type: 'container' }
 */
export function buildCommandArgs(item, config) {
  const actionType = config.action?.type || "local";

  switch (actionType) {
    case "local":
      return { ...buildLocalCommandArgs(item, config), type: "local" };
    case "container":
      return { ...buildContainerCommandArgs(item, config), type: "container" };
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
  const cmdInfo = buildCommandArgs(item, config);
  
  const quoteArgs = (args) => args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
  
  if (cmdInfo.type === "container") {
    const upCmd = quoteArgs(cmdInfo.upArgs);
    const execCmd = quoteArgs(cmdInfo.execArgs);
    return `(cd ${cmdInfo.cwd} && ${upCmd} && ${execCmd})`;
  }
  
  // Local type - show cwd for clarity
  const cmdStr = quoteArgs(cmdInfo.args);
  return cmdInfo.cwd ? `(cd ${cmdInfo.cwd} && ${cmdStr})` : cmdStr;
}

/**
 * Execute a spawn command and return a promise
 */
function runSpawn(args, options = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...cmdArgs] = args;
    const spawnOpts = {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    };
    const child = spawn(cmd, cmdArgs, spawnOpts);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code, success: code === 0 });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
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
  const cmdInfo = buildCommandArgs(item, config);
  const command = buildCommand(item, config); // For logging/display

  if (options.dryRun) {
    return {
      command,
      dryRun: true,
    };
  }

  if (cmdInfo.type === "container") {
    // Two-step container action:
    // 1. Run ocdc up to start container
    const upResult = await runSpawn(cmdInfo.upArgs, { cwd: cmdInfo.cwd });
    if (!upResult.success) {
      return {
        command,
        stdout: upResult.stdout,
        stderr: upResult.stderr,
        exitCode: upResult.exitCode,
        success: false,
        step: "up",
      };
    }

    // Parse workspace from ocdc up output
    let workspace;
    try {
      const upOutput = JSON.parse(upResult.stdout);
      workspace = upOutput.workspace;
    } catch {
      // If we can't parse JSON, try to continue without workspace flag
      workspace = null;
    }

    // 2. Run ocdc exec to start opencode in container
    const execArgs = [...cmdInfo.execArgs];
    if (workspace) {
      // Insert --workspace before --
      const dashDashIndex = execArgs.indexOf("--");
      if (dashDashIndex > 0) {
        execArgs.splice(dashDashIndex, 0, "--workspace", workspace);
      }
    }

    const execResult = await runSpawn(execArgs, { cwd: cmdInfo.cwd });
    return {
      command,
      stdout: upResult.stdout + "\n" + execResult.stdout,
      stderr: upResult.stderr + "\n" + execResult.stderr,
      exitCode: execResult.exitCode,
      success: execResult.success,
      workspace,
    };
  }

  // Local action - single command
  const result = await runSpawn(cmdInfo.args);
  return {
    command,
    ...result,
  };
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
