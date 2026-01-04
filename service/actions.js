/**
 * actions.js - Action system for starting sessions
 *
 * Supports two action types:
 * - local: Start OpenCode directly in a directory
 * - container: Use devcontainer CLI for isolated environment
 */

import { spawn } from "child_process";
import { readFile, writeFile, mkdir, access, stat, copyFile, readdir } from "fs/promises";
import { createHash } from "crypto";
import { createServer } from "net";
import path from "path";
import os from "os";
import { existsSync } from "fs";

// ============ Path Configuration ============

const PATHS = {
  get cache() {
    return process.env.OCDC_CACHE_DIR || path.join(os.homedir(), '.cache/ocdc');
  },
  get clones() {
    return process.env.OCDC_CLONES_DIR || path.join(os.homedir(), '.cache/devcontainer-clones');
  },
  get config() {
    return process.env.OCDC_CONFIG_DIR || path.join(os.homedir(), '.config/ocdc');
  },
  get ports() {
    return path.join(this.cache, 'ports.json');
  },
  get overrides() {
    return path.join(this.cache, 'overrides');
  },
  get configFile() {
    return path.join(this.config, 'config.json');
  },
};

// Default port range
const DEFAULT_PORT_START = 13000;
const DEFAULT_PORT_END = 13099;

// Lock files to skip when copying gitignored files
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Gemfile.lock', 'Cargo.lock', 'poetry.lock', 'composer.lock',
]);

// ============ Utility Functions ============

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
 * Check if a file exists
 */
async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a deterministic ID for a workspace path
 */
function pathId(p) {
  return createHash('md5').update(p).digest('hex');
}

/**
 * Ensure directories exist and initialize files
 */
async function ensureDirs() {
  await mkdir(PATHS.cache, { recursive: true });
  await mkdir(PATHS.config, { recursive: true });
  await mkdir(PATHS.overrides, { recursive: true });
  await mkdir(PATHS.clones, { recursive: true });
  
  if (!existsSync(PATHS.ports)) {
    await writeFile(PATHS.ports, '{}');
  }
  if (!existsSync(PATHS.configFile)) {
    await writeFile(PATHS.configFile, JSON.stringify({
      portRangeStart: DEFAULT_PORT_START,
      portRangeEnd: DEFAULT_PORT_END,
    }, null, 2));
  }
}

// ============ Port Management ============

/**
 * File-based locking using mkdir
 */
async function withLock(lockPath, fn) {
  const lockDir = lockPath + '.lock';
  const maxRetries = 100;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await mkdir(lockDir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      await new Promise(r => setTimeout(r, 50));
    }
  }
  
  try {
    return await fn();
  } finally {
    const { rm } = await import('fs/promises');
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Check if a port is free
 */
async function isPortFree(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Read ports.json
 */
async function readPorts() {
  try {
    return JSON.parse(await readFile(PATHS.ports, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write ports.json
 */
async function writePorts(ports) {
  await writeFile(PATHS.ports, JSON.stringify(ports, null, 2));
}

/**
 * Load user config
 */
async function loadConfig() {
  try {
    const content = await readFile(PATHS.configFile, 'utf-8');
    const config = JSON.parse(content);
    return {
      portRangeStart: config.portRangeStart || DEFAULT_PORT_START,
      portRangeEnd: config.portRangeEnd || DEFAULT_PORT_END,
    };
  } catch {
    return { portRangeStart: DEFAULT_PORT_START, portRangeEnd: DEFAULT_PORT_END };
  }
}

/**
 * Allocate a port for a workspace
 */
async function allocatePort(workspace, repoName, branch) {
  const lockPath = path.join(PATHS.cache, 'ports');
  
  return withLock(lockPath, async () => {
    const ports = await readPorts();
    const config = await loadConfig();
    
    // Return existing allocation
    if (ports[workspace]) {
      return ports[workspace];
    }
    
    // Find available port
    for (let port = config.portRangeStart; port <= config.portRangeEnd; port++) {
      const assigned = Object.values(ports).some(p => p.port === port);
      if (!assigned && await isPortFree(port)) {
        const now = new Date().toISOString();
        ports[workspace] = { port, repo: repoName, branch, started: now };
        await writePorts(ports);
        return ports[workspace];
      }
    }
    
    throw new Error(`No available ports in range ${config.portRangeStart}-${config.portRangeEnd}`);
  });
}

/**
 * Release a port allocation
 */
async function releasePort(workspace) {
  const lockPath = path.join(PATHS.cache, 'ports');
  
  return withLock(lockPath, async () => {
    const ports = await readPorts();
    delete ports[workspace];
    await writePorts(ports);
  });
}

// ============ Git Operations ============

/**
 * Run a git command
 */
async function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }));
    child.on('error', reject);
  });
}

async function getCurrentBranch(dir) {
  const result = await runGit(['branch', '--show-current'], dir);
  return result.exitCode === 0 ? result.stdout : null;
}

async function getRemoteUrl(dir) {
  const result = await runGit(['remote', 'get-url', 'origin'], dir);
  return result.exitCode === 0 ? result.stdout : null;
}

async function getRepoRoot(dir) {
  const result = await runGit(['rev-parse', '--show-toplevel'], dir);
  return result.exitCode === 0 ? result.stdout : null;
}

async function listIgnoredFiles(dir) {
  const result = await runGit(['ls-files', '--others', '--ignored', '--exclude-standard'], dir);
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

// ============ Clone Management ============

/**
 * Copy gitignored files from source repo to clone
 */
async function copyGitignored(source, dest) {
  const ignoredFiles = await listIgnoredFiles(source);
  if (ignoredFiles.length === 0) return 0;

  // Count files per top-level directory
  const dirFileCounts = new Map();
  for (const file of ignoredFiles) {
    const topDir = file.split('/')[0];
    const key = file.includes('/') ? topDir : '.';
    dirFileCounts.set(key, (dirFileCounts.get(key) || 0) + 1);
  }

  let copied = 0;
  const MAX_FILES_PER_DIR = 10;
  const MAX_FILE_SIZE = 102400;

  for (const relPath of ignoredFiles) {
    if (relPath.includes('..')) continue;
    const filename = path.basename(relPath);
    if (SKIP_FILES.has(filename)) continue;

    const topDir = relPath.includes('/') ? relPath.split('/')[0] : '.';
    if (dirFileCounts.get(topDir) > MAX_FILES_PER_DIR) continue;

    const srcPath = path.join(source, relPath);
    const destPath = path.join(dest, relPath);

    try {
      const srcStat = await stat(srcPath);
      if (!srcStat.isFile()) continue;
      if (srcStat.size > MAX_FILE_SIZE) continue;
      if (existsSync(destPath)) continue;

      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
      copied++;
    } catch {
      // Skip files we can't read
    }
  }

  return copied;
}

/**
 * Create a clone for a branch
 */
async function createClone(repoRoot, branchName) {
  const repoName = path.basename(repoRoot);
  const workspace = path.join(PATHS.clones, repoName, branchName);
  
  if (existsSync(workspace)) {
    return { workspace, created: false, repoName, branch: branchName };
  }
  
  await mkdir(path.dirname(workspace), { recursive: true });
  
  const remoteUrl = await getRemoteUrl(repoRoot);
  
  if (remoteUrl) {
    // Clone with reference
    const result = await runGit(['clone', '--reference', repoRoot, '--dissociate', '--branch', branchName, remoteUrl, workspace], process.cwd());
    if (result.exitCode !== 0) {
      // Branch might not exist, clone without branch flag and create it
      const cloneResult = await runGit(['clone', '--reference', repoRoot, '--dissociate', remoteUrl, workspace], process.cwd());
      if (cloneResult.exitCode !== 0) {
        throw new Error(`Clone failed: ${cloneResult.stderr}`);
      }
      await runGit(['checkout', '-b', branchName], workspace);
    }
  } else {
    // Local clone
    await runGit(['clone', repoRoot, workspace], process.cwd());
    await runGit(['checkout', '-b', branchName], workspace);
  }
  
  // Copy gitignored files (secrets, local config)
  await copyGitignored(repoRoot, workspace);
  
  return { workspace, created: true, repoName, branch: branchName };
}

// ============ Devcontainer Config ============

/**
 * Read devcontainer.json
 */
async function readDevcontainerJson(workspace) {
  const paths = [
    path.join(workspace, '.devcontainer', 'devcontainer.json'),
    path.join(workspace, '.devcontainer.json'),
  ];
  
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(await readFile(p, 'utf-8'));
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Detect internal port from config
 */
function detectInternalPort(config) {
  if (!config) return 3000;
  
  if (Array.isArray(config.forwardPorts) && config.forwardPorts.length > 0) {
    const port = config.forwardPorts[0];
    if (typeof port === 'number') return port;
  }
  
  if (Array.isArray(config.runArgs)) {
    for (let i = 0; i < config.runArgs.length; i++) {
      const arg = config.runArgs[i];
      if (arg === '-p' && i + 1 < config.runArgs.length) {
        const parts = config.runArgs[i + 1].split(':');
        if (parts.length === 2) return parseInt(parts[1], 10);
      }
      if (/^\d+:\d+$/.test(arg)) {
        return parseInt(arg.split(':')[1], 10);
      }
    }
  }
  
  return 3000;
}

/**
 * Remove port mappings from runArgs
 */
function removePortArgs(runArgs) {
  if (!Array.isArray(runArgs)) return [];
  const result = [];
  let skipNext = false;

  for (const arg of runArgs) {
    if (skipNext) { skipNext = false; continue; }
    if (arg === '-p') { skipNext = true; continue; }
    if (/^\d+:\d+$/.test(arg)) continue;
    result.push(arg);
  }

  return result;
}

/**
 * Generate override config
 */
async function generateOverrideConfig(workspace, port) {
  const baseConfig = await readDevcontainerJson(workspace) || {};
  const internalPort = detectInternalPort(baseConfig);
  const workspaceName = path.basename(workspace);
  
  const override = {
    ...baseConfig,
    name: `${workspaceName} (port ${port})`,
    workspaceFolder: `/workspaces/${workspaceName}`,
    runArgs: [
      ...removePortArgs(baseConfig.runArgs),
      '-p',
      `${port}:${internalPort}`,
    ],
  };
  
  const overridePath = path.join(PATHS.overrides, `${pathId(workspace)}.json`);
  await mkdir(PATHS.overrides, { recursive: true });
  await writeFile(overridePath, JSON.stringify(override, null, 2));
  
  return overridePath;
}

// ============ Session Name Building ============

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

// ============ Command Execution ============

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

// ============ Action Building ============

/**
 * Build command args for local action type
 * @returns {object} { args: string[], cwd: string }
 */
function buildLocalCommandArgs(item, config) {
  const repoPath = expandPath(config.repo_path || ".");
  const sessionName = config.session?.name_template
    ? buildSessionName(config.session.name_template, item)
    : `issue-${item.number || Date.now()}`;

  const args = ["opencode", "run"];
  args.push("--session", sessionName);

  if (config.session?.agent) {
    args.push("--agent", config.session.agent);
  }

  // Include both title and body for full context
  const promptParts = [];
  if (item.title) promptParts.push(item.title);
  if (item.body) promptParts.push(item.body);
  const prompt = promptParts.join("\n\n");
  if (prompt) {
    args.push(prompt);
  }

  return { args, cwd: repoPath };
}

/**
 * Build command args array for an action
 */
export function buildCommandArgs(item, config) {
  const actionType = config.action?.type || "local";

  switch (actionType) {
    case "local":
      return { ...buildLocalCommandArgs(item, config), type: "local" };
    case "container":
      // Container actions are handled specially in executeAction
      const repoPath = expandPath(config.repo_path || ".");
      const sessionName = config.session?.name_template
        ? buildSessionName(config.session.name_template, item)
        : `issue-${item.number || Date.now()}`;
      return { cwd: repoPath, sessionName, type: "container", item, config };
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

/**
 * Build command string for display/logging
 */
export function buildCommand(item, config) {
  const cmdInfo = buildCommandArgs(item, config);
  
  if (cmdInfo.type === "container") {
    return `(devcontainer up/exec: ${cmdInfo.sessionName} in ${cmdInfo.cwd})`;
  }
  
  const quoteArgs = (args) => args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
  const cmdStr = quoteArgs(cmdInfo.args);
  return cmdInfo.cwd ? `(cd ${cmdInfo.cwd} && ${cmdStr})` : cmdStr;
}

/**
 * Execute an action
 */
export async function executeAction(item, config, options = {}) {
  const cmdInfo = buildCommandArgs(item, config);
  const command = buildCommand(item, config);

  if (options.dryRun) {
    return { command, dryRun: true };
  }

  if (cmdInfo.type === "container") {
    // Container action - use devcontainer CLI directly
    await ensureDirs();
    
    const repoPath = cmdInfo.cwd;
    const sessionName = cmdInfo.sessionName;
    
    // Get repo root
    const repoRoot = await getRepoRoot(repoPath);
    if (!repoRoot) {
      return {
        command,
        success: false,
        stderr: `Not in a git repository: ${repoPath}`,
        exitCode: 1,
      };
    }
    
    // Create clone
    let cloneResult;
    try {
      cloneResult = await createClone(repoRoot, sessionName);
    } catch (e) {
      return {
        command,
        success: false,
        stderr: `Clone failed: ${e.message}`,
        exitCode: 1,
      };
    }
    
    const workspace = cloneResult.workspace;
    const repoName = cloneResult.repoName;
    const branch = cloneResult.branch;
    
    // Check for devcontainer.json
    if (!await readDevcontainerJson(workspace)) {
      return {
        command,
        success: false,
        stderr: `No devcontainer.json found in ${workspace}`,
        exitCode: 1,
      };
    }
    
    // Allocate port
    let portInfo;
    try {
      portInfo = await allocatePort(workspace, repoName, branch);
    } catch (e) {
      return {
        command,
        success: false,
        stderr: e.message,
        exitCode: 1,
      };
    }
    
    // Generate override config
    const overridePath = await generateOverrideConfig(workspace, portInfo.port);
    
    // Run devcontainer up
    const upArgs = ['devcontainer', 'up', '--workspace-folder', workspace, '--override-config', overridePath];
    const upResult = await runSpawn(upArgs);
    
    if (!upResult.success) {
      await releasePort(workspace);
      return {
        command,
        stdout: upResult.stdout,
        stderr: upResult.stderr,
        exitCode: upResult.exitCode,
        success: false,
        step: 'up',
      };
    }
    
    // Run opencode inside container
    const execArgs = ['devcontainer', 'exec', '--workspace-folder', workspace, '--override-config', overridePath, '--'];
    execArgs.push('opencode', 'run', '--session', sessionName);
    
    if (config.session?.agent) {
      execArgs.push('--agent', config.session.agent);
    }
    
    // Include both title and body for full context
    const promptParts = [];
    if (item.title) promptParts.push(item.title);
    if (item.body) promptParts.push(item.body);
    const prompt = promptParts.join("\n\n");
    if (prompt) {
      execArgs.push(prompt);
    }
    
    const execResult = await runSpawn(execArgs);
    
    return {
      command,
      stdout: upResult.stdout + '\n' + execResult.stdout,
      stderr: upResult.stderr + '\n' + execResult.stderr,
      exitCode: execResult.exitCode,
      success: execResult.success,
      workspace,
      port: portInfo.port,
    };
  }

  // Local action - single command
  const result = await runSpawn(cmdInfo.args, { cwd: cmdInfo.cwd });
  return {
    command,
    ...result,
  };
}

/**
 * Check if opencode is available
 */
export async function checkOpencode() {
  return new Promise((resolve) => {
    const child = spawn("which", ["opencode"]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Check if devcontainer CLI is available
 */
export async function checkDevcontainer() {
  return new Promise((resolve) => {
    const child = spawn("which", ["devcontainer"]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Validate that required tools are available for action type
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
    const hasDevcontainer = await checkDevcontainer();
    if (!hasDevcontainer) {
      missing.push("devcontainer (npm install -g @devcontainers/cli)");
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
