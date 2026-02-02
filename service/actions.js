/**
 * actions.js - Action system for starting sessions
 *
 * Starts OpenCode sessions with configurable prompts.
 * Supports prompt_template for custom prompts (e.g., to invoke /devcontainer).
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { debug } from "./logger.js";
import { getNestedValue } from "./utils.js";
import { getServerPort } from "./repo-config.js";
import { resolveWorktreeDirectory, getProjectInfo, getProjectInfoForDirectory } from "./worktree.js";
import path from "path";
import os from "os";

/**
 * Get running opencode server ports by parsing lsof output
 * @returns {Promise<number[]>} Array of port numbers
 */
async function getOpencodePorts() {
  try {
    // Use full path to lsof since /usr/sbin may not be in PATH in all contexts
    // (e.g., when running as a service or from certain shell environments)
    const output = execSync('/usr/sbin/lsof -i -P 2>/dev/null | grep -E "opencode.*LISTEN" || true', {
      encoding: 'utf-8',
      timeout: 30000
    });
    
    const ports = [];
    for (const line of output.split('\n')) {
      // Parse lines like: opencode-  6897 athal   12u  IPv4 ... TCP *:60993 (LISTEN)
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) {
        ports.push(parseInt(match[1], 10));
      }
    }
    return ports;
  } catch {
    return [];
  }
}

/**
 * Check if targetPath is within or equal to worktree path
 * @param {string} targetPath - The path we're looking for
 * @param {string} worktree - The server's worktree path
 * @param {string[]} sandboxes - Array of sandbox paths
 * @returns {number} Match score (higher = better match, 0 = no match)
 */
function getPathMatchScore(targetPath, worktree, sandboxes = []) {
  // Normalize paths
  const normalizedTarget = path.resolve(targetPath);
  const normalizedWorktree = path.resolve(worktree);
  
  // Exact sandbox match (highest priority)
  for (const sandbox of sandboxes) {
    const normalizedSandbox = path.resolve(sandbox);
    if (normalizedTarget === normalizedSandbox || normalizedTarget.startsWith(normalizedSandbox + path.sep)) {
      return normalizedSandbox.length + 1000; // Bonus for sandbox match
    }
  }
  
  // Exact worktree match
  if (normalizedTarget === normalizedWorktree) {
    return normalizedWorktree.length + 500; // Bonus for exact match
  }
  
  // Target is subdirectory of worktree
  if (normalizedTarget.startsWith(normalizedWorktree + path.sep)) {
    return normalizedWorktree.length;
  }
  
  // Global project (worktree = "/") matches everything with lowest priority
  if (normalizedWorktree === '/') {
    return 1;
  }
  
  return 0; // No match
}

/**
 * Verify a server is healthy by checking it returns valid project data
 * @param {string} url - Server URL
 * @param {object} project - Project data already fetched from /project/current
 * @returns {boolean} True if server appears healthy
 */
function isServerHealthy(project) {
  // A healthy server should return a project with an id and time.created
  // Stale/broken servers may return HTML or incomplete JSON
  return !!(
    project &&
    typeof project === 'object' &&
    project.id &&
    project.time &&
    typeof project.time.created === 'number'
  );
}

/**
 * Discover a running opencode server that matches the target directory
 * 
 * Queries all running opencode servers and finds the best match based on:
 * 1. Configured server_port (highest priority if set and healthy)
 * 2. Exact sandbox match
 * 3. Exact worktree match
 * 4. Target is subdirectory of worktree
 * 5. Global server (worktree="/") as fallback
 * 
 * Global servers are used as a fallback when no project-specific match is found,
 * since OpenCode Desktop may be connected to a global server that can display
 * sessions for any project.
 * 
 * @param {string} targetDir - The directory we want to work in
 * @param {object} [options] - Options for testing/mocking
 * @param {function} [options.getPorts] - Function to get server ports
 * @param {function} [options.fetch] - Function to fetch URLs
 * @param {number} [options.preferredPort] - Preferred port to use (overrides config)
 * @returns {Promise<string|null>} Server URL (e.g., "http://localhost:4096") or null
 */
export async function discoverOpencodeServer(targetDir, options = {}) {
  const getPorts = options.getPorts || getOpencodePorts;
  const fetchFn = options.fetch || fetch;
  const preferredPort = options.preferredPort ?? getServerPort();
  
  const ports = await getPorts();
  if (ports.length === 0) {
    debug('discoverOpencodeServer: no servers found');
    return null;
  }
  
  debug(`discoverOpencodeServer: checking ${ports.length} servers for ${targetDir}, preferredPort=${preferredPort}`);
  
  // If preferred port is configured and running, check it first
  if (preferredPort && ports.includes(preferredPort)) {
    const url = `http://localhost:${preferredPort}`;
    try {
      const response = await fetchFn(`${url}/project/current`);
      if (response.ok) {
        const project = await response.json();
        if (isServerHealthy(project)) {
          debug(`discoverOpencodeServer: using preferred port ${preferredPort}`);
          return url;
        }
      }
    } catch (err) {
      debug(`discoverOpencodeServer: preferred port ${preferredPort} error: ${err.message}`);
    }
  }
  
  let bestMatch = null;
  let bestScore = 0;
  let globalServer = null;
  
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      const response = await fetchFn(`${url}/project/current`);
      if (!response.ok) {
        debug(`discoverOpencodeServer: ${url} returned ${response.status}`);
        continue;
      }
      
      const project = await response.json();
      
      // Health check: verify response has expected structure
      if (!isServerHealthy(project)) {
        debug(`discoverOpencodeServer: ${url} failed health check (invalid project data)`);
        continue;
      }
      
      const worktree = project.worktree || '/';
      const sandboxes = project.sandboxes || [];
      
      // Track global server as fallback (but prefer project-specific matches)
      if (worktree === '/') {
        debug(`discoverOpencodeServer: ${url} is global project, tracking as fallback`);
        globalServer = url;
        continue;
      }
      
      const score = getPathMatchScore(targetDir, worktree, sandboxes);
      debug(`discoverOpencodeServer: ${url} worktree=${worktree} score=${score}`);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = url;
      }
    } catch (err) {
      debug(`discoverOpencodeServer: ${url} error: ${err.message}`);
    }
  }
  
  // Use project-specific match if found, otherwise fall back to global server
  const result = bestMatch || globalServer;
  debug(`discoverOpencodeServer: best match=${bestMatch} score=${bestScore}, global=${globalServer}, using=${result}`);
  return result;
}

// Default templates directory
const DEFAULT_TEMPLATES_DIR = path.join(
  os.homedir(),
  ".config/opencode/pilot/templates"
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
 * Build a display string for dry-run logging
 * Shows what API call would be made
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @returns {string} Display string for logging
 */
export function buildCommand(item, config) {
  const workingDir = config.working_dir || config.path || config.repo_path;
  const cwd = workingDir ? expandPath(workingDir) : '(no path)';
  const sessionName = config.session?.name
    ? buildSessionName(config.session.name, item)
    : (item.title || `session-${Date.now()}`);
  
  return `[API] POST /session?directory=${cwd} (title: "${sessionName}")`;
}

/**
 * Create a session via the OpenCode HTTP API
 * 
 * This is a workaround for the known issue where `opencode run --attach` 
 * doesn't support a --dir flag, causing sessions to run in the wrong directory
 * when attached to a global server.
 * 
 * @param {string} serverUrl - Server URL (e.g., "http://localhost:4096")
 * @param {string} directory - Working directory for the session
 * @param {string} prompt - The prompt/message to send
 * @param {object} [options] - Options
 * @param {string} [options.title] - Session title
 * @param {string} [options.agent] - Agent to use
 * @param {string} [options.model] - Model to use
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with sessionId, success, error
 */
export async function createSessionViaApi(serverUrl, directory, prompt, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  let session = null;
  
  try {
    // Step 1: Create a new session with the directory parameter
    const sessionUrl = new URL('/session', serverUrl);
    sessionUrl.searchParams.set('directory', directory);
    
    const createResponse = await fetchFn(sessionUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create session: ${createResponse.status} ${errorText}`);
    }
    
    session = await createResponse.json();
    debug(`createSessionViaApi: created session ${session.id} in ${directory}`);
    
    // Step 2: Update session title if provided
    if (options.title) {
      const updateUrl = new URL(`/session/${session.id}`, serverUrl);
      updateUrl.searchParams.set('directory', directory);
      await fetchFn(updateUrl.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: options.title }),
      });
    }
    
    // Step 3: Send the initial message
    const messageUrl = new URL(`/session/${session.id}/message`, serverUrl);
    messageUrl.searchParams.set('directory', directory);
    
    // Build message body
    const messageBody = {
      parts: [{ type: 'text', text: prompt }],
    };
    
    // Add agent if specified
    if (options.agent) {
      messageBody.agent = options.agent;
    }
    
    // Add model if specified (format: provider/model)
    if (options.model) {
      const [providerID, modelID] = options.model.includes('/') 
        ? options.model.split('/', 2) 
        : ['anthropic', options.model];
      messageBody.providerID = providerID;
      messageBody.modelID = modelID;
    }
    
    // Use AbortController with timeout for the message POST
    // The /session/{id}/message endpoint returns a chunked/streaming response
    // that stays open until the agent completes. We only need to verify the
    // request was accepted (2xx status), not wait for the full response.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const messageResponse = await fetchFn(messageUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!messageResponse.ok) {
        const errorText = await messageResponse.text();
        throw new Error(`Failed to send message: ${messageResponse.status} ${errorText}`);
      }
      
      debug(`createSessionViaApi: sent message to session ${session.id}`);
    } catch (abortErr) {
      clearTimeout(timeoutId);
      // AbortError is expected - we intentionally abort after verifying the request started
      // The server accepted our message, we just don't need to wait for the response
      if (abortErr.name === 'AbortError') {
        debug(`createSessionViaApi: message request started for session ${session.id} (response aborted as expected)`);
      } else {
        throw abortErr;
      }
    }
    
    return {
      success: true,
      sessionId: session.id,
      directory,
    };
  } catch (err) {
    debug(`createSessionViaApi: error - ${err.message}`);
    // If session was created but message failed, still return success
    // to prevent re-processing (the session exists, user can send message manually)
    if (session) {
      debug(`createSessionViaApi: session ${session.id} was created, marking as success despite message error`);
      return {
        success: true,
        sessionId: session.id,
        directory,
        warning: err.message,
      };
    }
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Execute an action
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @param {object} [options] - Execution options
 * @param {boolean} [options.dryRun] - If true, return command without executing
 * @param {function} [options.discoverServer] - Custom server discovery function (for testing)
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with command, stdout, stderr, exitCode
 */
export async function executeAction(item, config, options = {}) {
  // Get base working directory - require explicit config, don't default to home
  const workingDir = config.working_dir || config.path || config.repo_path;
  
  // Fail-safe: require a valid local path to be configured
  if (!workingDir) {
    debug(`executeAction: skipping item - no local path configured`);
    return {
      success: false,
      skipped: true,
      error: 'No local path configured for this repository. Configure repos_dir or add explicit repo config.',
    };
  }
  
  const baseCwd = expandPath(workingDir);
  
  // Discover running opencode server for this directory
  const discoverFn = options.discoverServer || discoverOpencodeServer;
  const serverUrl = await discoverFn(baseCwd);
  
  debug(`executeAction: discovered server=${serverUrl} for baseCwd=${baseCwd}`);
  
  // Require OpenCode server - pilot runs as a plugin, so server should always be available
  // Mark as skipped (retriable) rather than hard error - server may still be initializing
  if (!serverUrl) {
    return {
      success: false,
      skipped: true,
      error: 'No OpenCode server found. Will retry on next poll.',
    };
  }
  
  // Resolve worktree directory if configured
  // This allows creating sessions in isolated worktrees instead of the main project
  let worktreeMode = config.worktree;
  
  // Auto-detect worktree support: check if the project has sandboxes
  if (!worktreeMode) {
    // Look up project info for this specific directory (not just /project/current)
    const projectInfo = await getProjectInfoForDirectory(serverUrl, baseCwd, { fetch: options.fetch });
    if (projectInfo?.sandboxes?.length > 0) {
      debug(`executeAction: auto-detected worktree support (${projectInfo.sandboxes.length} sandboxes)`);
      worktreeMode = 'new';
    }
  }
  
  const worktreeConfig = {
    worktree: worktreeMode,
    // Expand worktree_name template with item fields (e.g., "issue-{number}")
    worktreeName: config.worktree_name ? expandTemplate(config.worktree_name, item) : undefined,
  };
  
  const worktreeResult = await resolveWorktreeDirectory(
    serverUrl,
    baseCwd,
    worktreeConfig,
    { fetch: options.fetch }
  );
  
  const cwd = expandPath(worktreeResult.directory);
  
  if (worktreeResult.worktreeCreated) {
    debug(`executeAction: created new worktree at ${cwd}`);
  } else if (worktreeResult.error) {
    debug(`executeAction: worktree resolution warning - ${worktreeResult.error}`);
  }
  
  debug(`executeAction: using cwd=${cwd}`);
  
  // Build prompt from template
  const prompt = buildPromptFromTemplate(config.prompt || "default", item);
  
  // Build session title
  const sessionTitle = config.session?.name
    ? buildSessionName(config.session.name, item)
    : (item.title || `session-${Date.now()}`);
  
  const apiCommand = `[API] POST ${serverUrl}/session?directory=${cwd}`;
  debug(`executeAction: using HTTP API - ${apiCommand}`);
  
  if (options.dryRun) {
    return {
      command: apiCommand,
      dryRun: true,
    };
  }
  
  const result = await createSessionViaApi(serverUrl, cwd, prompt, {
    title: sessionTitle,
    agent: config.agent,
    model: config.model,
    fetch: options.fetch,
  });
  
  return {
    command: apiCommand,
    success: result.success,
    sessionId: result.sessionId,
    error: result.error,
  };
}
