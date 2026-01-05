/**
 * actions.js - Action system for starting sessions
 *
 * Starts OpenCode sessions with configurable prompts.
 * Supports prompt_template for custom prompts (e.g., to invoke /devcontainer).
 */

import { spawn } from "child_process";
import { debug } from "./logger.js";
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
 * Expand a template string with item fields
 * @param {string} template - Template with {placeholders}
 * @param {object} item - Item with fields to substitute
 * @returns {string} Expanded string
 */
export function expandTemplate(template, item) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return item[key] !== undefined ? String(item[key]) : `{${key}}`;
  });
}

/**
 * Build session name from template
 * @param {string} template - Template with {placeholders}
 * @param {object} item - Item with fields to substitute
 * @returns {string} Expanded session name
 */
export function buildSessionName(template, item) {
  return expandTemplate(template, item);
}

/**
 * Build the prompt from item and config
 * Uses prompt_template if provided, otherwise combines title and body
 * @param {object} item - Item with title, body, etc.
 * @param {object} config - Config with optional session.prompt_template
 * @returns {string} The prompt to send to opencode
 */
function buildPrompt(item, config) {
  // If prompt_template is provided, expand it
  if (config.session?.prompt_template) {
    return expandTemplate(config.session.prompt_template, item);
  }
  
  // Default: combine title and body
  const parts = [];
  if (item.title) parts.push(item.title);
  if (item.body) parts.push(item.body);
  return parts.join("\n\n");
}

/**
 * Build command args for action
 * Uses "opencode run" for non-interactive execution
 * @returns {object} { args: string[], cwd: string }
 */
function buildCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");
  const sessionTitle = config.session?.name_template
    ? buildSessionName(config.session.name_template, item)
    : `issue-${item.number || Date.now()}`;

  // Build opencode run command args array (non-interactive)
  // Note: --title sets session title (--session is for continuing existing sessions)
  const args = ["opencode", "run"];

  // Add title for the session (helps identify it later)
  args.push("--title", sessionTitle);

  // Add agent if specified
  if (config.session?.agent) {
    args.push("--agent", config.session.agent);
  }

  // Add prompt (must be last for "run" command)
  const prompt = buildPrompt(item, config);
  if (prompt) {
    args.push(prompt);
  }

  return { args, cwd: repoPath };
}

/**
 * Get command info for an action
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {object} { args: string[], cwd: string }
 */
export function getCommandInfo(item, config) {
  return buildCommandArgs(item, config);
}

/**
 * Build command string for display/logging
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {string} Command string (for display only)
 */
export function buildCommand(item, config) {
  const cmdInfo = getCommandInfo(item, config);
  
  const quoteArgs = (args) => args.map(a => 
    a.includes(" ") || a.includes("\n") ? `"${a.replace(/"/g, '\\"')}"` : a
  ).join(" ");
  
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
  const cmdInfo = getCommandInfo(item, config);
  const command = buildCommand(item, config); // For logging/display

  debug(`executeAction: command=${command}`);
  debug(`executeAction: args=${JSON.stringify(cmdInfo.args)}, cwd=${cmdInfo.cwd}`);

  if (options.dryRun) {
    return {
      command,
      dryRun: true,
    };
  }

  // Execute opencode run in background (detached)
  // We don't wait for completion since sessions can run for a long time
  debug(`executeAction: spawning opencode run (detached)`);
  const [cmd, ...cmdArgs] = cmdInfo.args;
  const child = spawn(cmd, cmdArgs, {
    cwd: cmdInfo.cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  
  debug(`executeAction: spawned pid=${child.pid}`);
  return {
    command,
    success: true,
    pid: child.pid,
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
 * Validate that required tools are available
 * @returns {Promise<object>} { valid: boolean, missing?: string[] }
 */
export async function validateTools() {
  const missing = [];

  const hasOpencode = await checkOpencode();
  if (!hasOpencode) {
    missing.push("opencode");
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
