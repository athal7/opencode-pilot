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

// Safety timeout for the server to return HTTP response headers.
// The /command endpoint can take 30-45s to return headers because it does
// work before responding. The /message endpoint returns headers in ~1ms.
// These are generous upper bounds — if exceeded, the server is genuinely stuck.
export const HEADER_TIMEOUT_MS = 60_000;

/**
 * Parse a slash command from the beginning of a prompt
 * Returns null if the prompt doesn't start with a slash command
 * 
 * @param {string} prompt - The prompt text
 * @returns {object|null} { command, arguments, rest } or null
 */
export function parseSlashCommand(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return null;
  }
  
  // Match /command at the start, followed by optional arguments on the same line
  // Command names can contain letters, numbers, hyphens, and underscores
  const match = prompt.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/m);
  
  if (!match) {
    return null;
  }
  
  const command = match[1];
  const firstLineArgs = match[2]?.trim() || '';
  
  // Find where the first line ends to get the "rest" of the prompt
  const firstNewline = prompt.indexOf('\n');
  const rest = firstNewline >= 0 ? prompt.slice(firstNewline + 1).trim() : '';
  
  return {
    command,
    arguments: firstLineArgs,
    rest,
  };
}

/**
 * Send a command to a session via the /command endpoint
 * 
 * @param {string} serverUrl - Server URL
 * @param {string} sessionId - Session ID
 * @param {string} directory - Working directory
 * @param {object} parsedCommand - Parsed command from parseSlashCommand
 * @param {object} [options] - Options
 * @param {string} [options.agent] - Agent to use
 * @param {string} [options.model] - Model to use
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<Response>} The fetch response
 */
async function sendCommand(serverUrl, sessionId, directory, parsedCommand, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  const commandUrl = new URL(`/session/${sessionId}/command`, serverUrl);
  commandUrl.searchParams.set('directory', directory);
  
  // Build command body per OpenCode API schema
  const commandBody = {
    command: parsedCommand.command,
    arguments: parsedCommand.arguments,
  };
  
  // Add agent if specified
  if (options.agent) {
    commandBody.agent = options.agent;
  }
  
  // Add model if specified (the /command endpoint takes model as a single string)
  if (options.model) {
    commandBody.model = options.model;
  }
  
  debug(`sendCommand: POST ${commandUrl} command=${parsedCommand.command} args=${parsedCommand.arguments}`);
  
  return fetchFn(commandUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commandBody),
  });
}

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
 * List sessions from the OpenCode server
 * 
 * @param {string} serverUrl - Server URL (e.g., "http://localhost:4096")
 * @param {object} [options] - Options
 * @param {string} [options.directory] - Filter by directory
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<Array>} Array of session objects
 */
export async function listSessions(serverUrl, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const url = new URL('/session', serverUrl);
    if (options.directory) {
      url.searchParams.set('directory', options.directory);
    }
    // Only get root sessions (not child/forked sessions)
    url.searchParams.set('roots', 'true');
    
    const response = await fetchFn(url.toString());
    
    if (!response.ok) {
      debug(`listSessions: ${serverUrl} returned ${response.status}`);
      return [];
    }
    
    const sessions = await response.json();
    return Array.isArray(sessions) ? sessions : [];
  } catch (err) {
    debug(`listSessions: error - ${err.message}`);
    return [];
  }
}

/**
 * Check if a session is archived
 * A session is archived if time.archived is set (it's a timestamp)
 * 
 * @param {object} session - Session object from API
 * @returns {boolean} True if session is archived
 */
export function isSessionArchived(session) {
  return session?.time?.archived !== undefined;
}

/**
 * Get session statuses from the OpenCode server
 * Returns a map of sessionId -> status (idle, busy, retry)
 * Sessions not in the map are considered idle
 * 
 * @param {string} serverUrl - Server URL
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Map of sessionId -> status object
 */
export async function getSessionStatuses(serverUrl, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const response = await fetchFn(`${serverUrl}/session/status`);
    
    if (!response.ok) {
      debug(`getSessionStatuses: ${serverUrl} returned ${response.status}`);
      return {};
    }
    
    return await response.json();
  } catch (err) {
    debug(`getSessionStatuses: error - ${err.message}`);
    return {};
  }
}

/**
 * Find the best session to reuse from a list of candidates
 * Prefers idle sessions, then most recently updated
 * 
 * @param {Array} sessions - Array of non-archived sessions
 * @param {object} statuses - Map of sessionId -> status from /session/status
 * @returns {object|null} Best session to reuse, or null if none
 */
export function selectBestSession(sessions, statuses) {
  if (!sessions || sessions.length === 0) {
    return null;
  }
  
  // Separate idle vs busy/retry sessions
  const idle = [];
  const other = [];
  
  for (const session of sessions) {
    const status = statuses[session.id];
    // Sessions not in statuses map are idle (per OpenCode behavior)
    if (!status || status.type === 'idle') {
      idle.push(session);
    } else {
      other.push(session);
    }
  }
  
  // Sort by most recently updated (highest time.updated first)
  const sortByUpdated = (a, b) => (b.time?.updated || 0) - (a.time?.updated || 0);
  
  // Prefer idle sessions
  if (idle.length > 0) {
    idle.sort(sortByUpdated);
    return idle[0];
  }
  
  // Fall back to busy/retry sessions (sorted by most recent)
  if (other.length > 0) {
    other.sort(sortByUpdated);
    return other[0];
  }
  
  return null;
}

/**
 * Send a message to an existing session
 * 
 * @param {string} serverUrl - Server URL
 * @param {string} sessionId - Session ID to send message to
 * @param {string} directory - Working directory
 * @param {string} prompt - The prompt/message to send
 * @param {object} [options] - Options
 * @param {string} [options.title] - Update session title (optional)
 * @param {string} [options.agent] - Agent to use
 * @param {string} [options.model] - Model to use
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with sessionId, success, error
 */
export async function sendMessageToSession(serverUrl, sessionId, directory, prompt, options = {}) {
  const fetchFn = options.fetch || fetch;
  const headerTimeout = options.headerTimeout || HEADER_TIMEOUT_MS;
  
  try {
    // Step 1: Update session title if provided
    if (options.title) {
      const updateUrl = new URL(`/session/${sessionId}`, serverUrl);
      updateUrl.searchParams.set('directory', directory);
      await fetchFn(updateUrl.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: options.title }),
      });
      debug(`sendMessageToSession: updated title for session ${sessionId}`);
    }
    
    // Step 2: Check if the prompt starts with a slash command
    const parsedCommand = parseSlashCommand(prompt);
    
    // Wait for response headers (confirming server accepted the request),
    // then abort the body stream. Safety timeout catches stuck requests.
    const controller = new AbortController();
    let headersReceived = false;
    const timeoutId = setTimeout(() => {
      if (!headersReceived) {
        debug(`sendMessageToSession: safety timeout - server did not return headers within ${headerTimeout}ms for session ${sessionId}`);
        controller.abort();
      }
    }, headerTimeout);
    
    try {
      let response;
      
      if (parsedCommand) {
        // Use the /command endpoint for slash commands
        debug(`sendMessageToSession: detected command /${parsedCommand.command}`);
        response = await sendCommand(serverUrl, sessionId, directory, parsedCommand, {
          agent: options.agent,
          model: options.model,
          fetch: (url, opts) => fetchFn(url, { ...opts, signal: controller.signal }),
        });
      } else {
        // Use the /message endpoint for regular prompts
        const messageUrl = new URL(`/session/${sessionId}/message`, serverUrl);
        messageUrl.searchParams.set('directory', directory);
        
        const messageBody = {
          parts: [{ type: 'text', text: prompt }],
        };
        
        if (options.agent) {
          messageBody.agent = options.agent;
        }
        
        if (options.model) {
          const [providerID, modelID] = options.model.includes('/') 
            ? options.model.split('/', 2) 
            : ['anthropic', options.model];
          messageBody.providerID = providerID;
          messageBody.modelID = modelID;
        }
        
        response = await fetchFn(messageUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageBody),
          signal: controller.signal,
        });
      }
      
      // Headers received — cancel the safety timeout
      headersReceived = true;
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send ${parsedCommand ? 'command' : 'message'}: ${response.status} ${errorText}`);
      }
      
      debug(`sendMessageToSession: ${parsedCommand ? 'command' : 'message'} accepted by server for session ${sessionId}`);
    } catch (abortErr) {
      clearTimeout(timeoutId);
      if (abortErr.name === 'AbortError' && !headersReceived) {
        throw new Error(`Server did not confirm acceptance within ${headerTimeout / 1000}s for session ${sessionId}`);
      }
      throw abortErr;
    } finally {
      // Abort the body stream — we don't need the streaming response content.
      // Done in finally to ensure cleanup regardless of success/error path.
      controller.abort();
    }
    
    return {
      success: true,
      sessionId,
      directory,
      reused: true,
    };
  } catch (err) {
    debug(`sendMessageToSession: error - ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Find an existing session to reuse for the given directory
 * Returns null if no suitable session found (archived sessions are excluded)
 * 
 * @param {string} serverUrl - Server URL
 * @param {string} directory - Working directory to match
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object|null>} Session to reuse, or null
 */
export async function findReusableSession(serverUrl, directory, options = {}) {
  // Get sessions for this directory
  const sessions = await listSessions(serverUrl, { 
    directory, 
    fetch: options.fetch 
  });
  
  if (sessions.length === 0) {
    debug(`findReusableSession: no sessions found for ${directory}`);
    return null;
  }
  
  // Filter out archived sessions
  const activeSessions = sessions.filter(s => !isSessionArchived(s));
  
  if (activeSessions.length === 0) {
    debug(`findReusableSession: all ${sessions.length} sessions are archived for ${directory}`);
    return null;
  }
  
  debug(`findReusableSession: found ${activeSessions.length} active sessions for ${directory}`);
  
  // Get statuses to prefer idle sessions
  const statuses = await getSessionStatuses(serverUrl, { fetch: options.fetch });
  
  // Select the best session
  return selectBestSession(activeSessions, statuses);
}

/**
 * Create a session via the OpenCode HTTP API
 * 
 * @param {string} serverUrl - Server URL (e.g., "http://localhost:4096")
 * @param {string} directory - Working directory for file operations (may be a worktree)
 * @param {string} prompt - The prompt/message to send
 * @param {object} [options] - Options
 * @param {string} [options.projectDirectory] - Project directory for session scoping (defaults to directory)
 * @param {string} [options.title] - Session title
 * @param {string} [options.agent] - Agent to use
 * @param {string} [options.model] - Model to use
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with sessionId, success, error
 */
export async function createSessionViaApi(serverUrl, directory, prompt, options = {}) {
  const fetchFn = options.fetch || fetch;
  const headerTimeout = options.headerTimeout || HEADER_TIMEOUT_MS;
  // Use project directory for session creation (determines projectID in OpenCode).
  // The working directory (which may be a worktree) is used for messages/commands.
  const projectDir = options.projectDirectory || directory;
  
  let session = null;
  
  try {
    // Step 1: Create session scoped to the project directory
    const sessionUrl = new URL('/session', serverUrl);
    sessionUrl.searchParams.set('directory', projectDir);
    
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
      updateUrl.searchParams.set('directory', projectDir);
      await fetchFn(updateUrl.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: options.title }),
      });
    }
    
    // Step 3: Check if the prompt starts with a slash command
    const parsedCommand = parseSlashCommand(prompt);
    
    // Wait for the server to return response headers (confirming it accepted the
    // request), then abort the body stream. The /command endpoint can take 30-45s
    // to return headers — we must NOT abort before that or we can't tell if the
    // server actually accepted. A generous safety timeout catches truly stuck requests.
    const controller = new AbortController();
    let headersReceived = false;
    const timeoutId = setTimeout(() => {
      if (!headersReceived) {
        debug(`createSessionViaApi: safety timeout - server did not return headers within ${headerTimeout}ms for session ${session.id}`);
        controller.abort();
      }
    }, headerTimeout);
    
    try {
      let response;
      
      if (parsedCommand) {
        // Use the /command endpoint for slash commands
        debug(`createSessionViaApi: detected command /${parsedCommand.command}`);
        response = await sendCommand(serverUrl, session.id, directory, parsedCommand, {
          agent: options.agent,
          model: options.model,
          fetch: (url, opts) => fetchFn(url, { ...opts, signal: controller.signal }),
        });
      } else {
        // Use the /message endpoint for regular prompts
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
        
        response = await fetchFn(messageUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageBody),
          signal: controller.signal,
        });
      }
      
      // Headers received — cancel the safety timeout
      headersReceived = true;
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send ${parsedCommand ? 'command' : 'message'}: ${response.status} ${errorText}`);
      }
      
      debug(`createSessionViaApi: ${parsedCommand ? 'command' : 'message'} accepted by server for session ${session.id}`);
    } catch (abortErr) {
      clearTimeout(timeoutId);
      if (abortErr.name === 'AbortError' && !headersReceived) {
        // Safety timeout fired before headers arrived.
        // The server may or may not have accepted the request — we don't know.
        throw new Error(`Server did not confirm acceptance within ${headerTimeout / 1000}s for session ${session.id}`);
      }
      throw abortErr;
    } finally {
      // Abort the body stream — we don't need the streaming response content.
      // Done in finally to ensure cleanup regardless of success/error path.
      controller.abort();
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
 * Execute session creation/reuse in a specific directory
 * Internal helper for executeAction - handles prompt building, session reuse, and API calls
 * 
 * @param {string} serverUrl - OpenCode server URL
 * @param {string} cwd - Working directory for the session
 * @param {object} item - Item to create session for
 * @param {object} config - Repo config with action settings
 * @param {object} [options] - Execution options
 * @returns {Promise<object>} Result with command, success, sessionId, etc.
 */
async function executeInDirectory(serverUrl, cwd, item, config, options = {}, projectDirectory = null) {
  // Build prompt from template
  const prompt = buildPromptFromTemplate(config.prompt || "default", item);
  
  // Build session title
  const sessionTitle = config.session?.name
    ? buildSessionName(config.session.name, item)
    : (item.title || `session-${Date.now()}`);
  
  // Check if we should reuse a stack sibling's session
  // This is set when another PR in the same stack was already processed
  if (config.reuse_stack_session && !options.dryRun) {
    try {
      debug(`executeInDirectory: trying stack session reuse ${config.reuse_stack_session} for ${cwd}`);
      
      const stackResult = await sendMessageToSession(serverUrl, config.reuse_stack_session, cwd, prompt, {
        title: sessionTitle,
        agent: config.agent,
        model: config.model,
        fetch: options.fetch,
      });
      
      if (stackResult.success) {
        const stackCommand = `[API] POST ${serverUrl}/session/${config.reuse_stack_session}/message (stack reuse)`;
        return {
          command: stackCommand,
          success: true,
          sessionId: stackResult.sessionId,
          directory: cwd,
          sessionReused: true,
          error: stackResult.error,
        };
      }
      
      debug(`executeInDirectory: stack session reuse failed, falling through`);
    } catch (err) {
      debug(`executeInDirectory: stack session reuse error, falling through: ${err.message}`);
    }
  }
  
  // Check if we should try to reuse an existing session
  const reuseActiveSession = config.reuse_active_session !== false; // default true
  
  if (reuseActiveSession && !options.dryRun) {
    const existingSession = await findReusableSession(serverUrl, cwd, { fetch: options.fetch });
    
    if (existingSession) {
      debug(`executeInDirectory: found reusable session ${existingSession.id} for ${cwd}`);
      
      const reuseCommand = `[API] POST ${serverUrl}/session/${existingSession.id}/message (reusing session)`;
      
      const result = await sendMessageToSession(serverUrl, existingSession.id, cwd, prompt, {
        title: sessionTitle,
        agent: config.agent,
        model: config.model,
        fetch: options.fetch,
      });
      
      return {
        command: reuseCommand,
        success: result.success,
        sessionId: result.sessionId,
        directory: cwd,
        sessionReused: true,
        error: result.error,
      };
    }
  }
  
  const apiCommand = `[API] POST ${serverUrl}/session?directory=${cwd}`;
  debug(`executeInDirectory: using HTTP API - ${apiCommand}`);
  
  if (options.dryRun) {
    return {
      command: apiCommand,
      directory: cwd,
      dryRun: true,
    };
  }
  
  const result = await createSessionViaApi(serverUrl, cwd, prompt, {
    projectDirectory: projectDirectory || cwd,
    title: sessionTitle,
    agent: config.agent,
    model: config.model,
    fetch: options.fetch,
  });
  
  return {
    command: apiCommand,
    success: result.success,
    sessionId: result.sessionId,
    directory: cwd,
    error: result.error,
    warning: result.warning,
  };
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
  
  // If existing_directory is provided (reprocessing same item), use it directly
  // This preserves the worktree from the previous run even if its name doesn't match the template
  if (config.existing_directory) {
    debug(`executeAction: using existing_directory=${config.existing_directory}`);
    const cwd = expandPath(config.existing_directory);
    return await executeInDirectory(serverUrl, cwd, item, config, options, baseCwd);
  }
  
  // Resolve worktree directory if configured
  // This allows creating sessions in isolated worktrees instead of the main project
  let worktreeMode = config.worktree;
  
  // If worktree_name is configured, enable worktree mode (explicit configuration)
  // This allows presets to specify worktree isolation without requiring existing sandboxes
  if (!worktreeMode && config.worktree_name) {
    debug(`executeAction: worktree_name configured, enabling worktree mode`);
    worktreeMode = 'new';
  }
  
  // Auto-detect worktree support: check if the project has sandboxes
  // This is a fallback for when worktree isn't explicitly configured
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
    // Config flag to control sandbox reuse (default true)
    preferExistingSandbox: config.prefer_existing_sandbox,
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
  } else if (worktreeResult.worktreeReused) {
    debug(`executeAction: reusing existing sandbox at ${cwd}`);
  } else if (worktreeResult.error) {
    debug(`executeAction: worktree resolution warning - ${worktreeResult.error}`);
  }
  
  debug(`executeAction: using cwd=${cwd}`);
  
  return await executeInDirectory(serverUrl, cwd, item, config, options, baseCwd);
}
