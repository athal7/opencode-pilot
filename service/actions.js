/**
 * actions.js - Action system for starting sessions
 *
 * Starts OpenCode sessions with configurable prompts.
 * Supports prompt_template for custom prompts (e.g., to invoke /devcontainer).
 */

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { debug } from "./logger.js";
import { getNestedValue } from "./utils.js";
import path from "path";
import os from "os";

// Default templates directory
const DEFAULT_TEMPLATES_DIR = path.join(
  os.homedir(),
  ".config/opencode-pilot/templates"
);

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
 * Supports both simple ({field}) and nested ({field.subfield}) references
 * @param {string} template - Template with {placeholders}
 * @param {object} item - Item with fields to substitute
 * @returns {string} Expanded string
 */
export function expandTemplate(template, item) {
  return template.replace(/\{([\w.]+)\}/g, (match, key) => {
    const value = getNestedValue(item, key);
    return value !== undefined ? String(value) : match;
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
 * Load a template file and expand it with item fields
 * @param {string} templateName - Template name (without .md extension)
 * @param {object} item - Item with fields to substitute
 * @param {string} [templatesDir] - Templates directory path (for testing)
 * @returns {string} Expanded template, or fallback to title+body
 */
export function buildPromptFromTemplate(templateName, item, templatesDir) {
  const dir = templatesDir || DEFAULT_TEMPLATES_DIR;
  const templatePath = path.join(dir, `${templateName}.md`);

  let template;
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else {
    // Fallback: combine title and body
    const parts = [];
    if (item.title) parts.push(item.title);
    if (item.body) parts.push(item.body);
    return parts.join("\n\n");
  }

  return expandTemplate(template, item);
}

/**
 * Merge source, repo config, and defaults into action config
 * Priority: source > repo > defaults
 * @param {object} source - Source configuration
 * @param {object} repoConfig - Repository configuration
 * @param {object} defaults - Default configuration
 * @returns {object} Merged action config
 */
export function getActionConfig(source, repoConfig, defaults) {
  return {
    // Defaults first
    ...defaults,
    // Repo config overrides defaults
    ...repoConfig,
    // Preserve nested session config
    session: {
      ...(defaults.session || {}),
      ...(repoConfig.session || {}),
    },
    // Source-level overrides (highest priority)
    ...(source.prompt && { prompt: source.prompt }),
    ...(source.agent && { agent: source.agent }),
    ...(source.model && { model: source.model }),
    ...(source.working_dir && { working_dir: source.working_dir }),
  };
}

/**
 * Get command info using new config format
 * @param {object} item - Item to create session for
 * @param {object} config - Merged action config
 * @param {string} [templatesDir] - Templates directory path (for testing)
 * @returns {object} { args: string[], cwd: string }
 */
export function getCommandInfoNew(item, config, templatesDir) {
  // Determine working directory: working_dir > path > repo_path > home
  const workingDir = config.working_dir || config.path || config.repo_path || "~";
  const cwd = expandPath(workingDir);

  // Build session name
  const sessionName = config.session?.name
    ? buildSessionName(config.session.name, item)
    : `session-${item.number || item.id || Date.now()}`;

  // Build command args
  const args = ["opencode", "run"];
  
  // Add session title
  args.push("--title", sessionName);
  
  // Add agent if specified
  if (config.agent) {
    args.push("--agent", config.agent);
  }
  
  // Add model if specified
  if (config.model) {
    args.push("--model", config.model);
  }

  // Build prompt from template
  const prompt = buildPromptFromTemplate(config.prompt || "default", item, templatesDir);
  if (prompt) {
    args.push(prompt);
  }

  return { args, cwd };
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
  return getCommandInfoNew(item, config);
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
