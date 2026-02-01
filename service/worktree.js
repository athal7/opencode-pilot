/**
 * worktree.js - Worktree management for OpenCode sessions
 *
 * Interacts with OpenCode server to list and create worktrees (sandboxes).
 * Worktrees allow running sessions in isolated git branches/directories.
 */

import { debug } from "./logger.js";

/**
 * List available worktrees/sandboxes for a project
 * 
 * @param {string} serverUrl - OpenCode server URL (e.g., "http://localhost:4096")
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<string[]>} Array of worktree directory paths
 */
export async function listWorktrees(serverUrl, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const response = await fetchFn(`${serverUrl}/experimental/worktree`);
    
    if (!response.ok) {
      debug(`listWorktrees: ${serverUrl} returned ${response.status}`);
      return [];
    }
    
    const worktrees = await response.json();
    debug(`listWorktrees: found ${worktrees.length} worktrees`);
    return Array.isArray(worktrees) ? worktrees : [];
  } catch (err) {
    debug(`listWorktrees: error - ${err.message}`);
    return [];
  }
}

/**
 * Create a new worktree for a project
 * 
 * @param {string} serverUrl - OpenCode server URL (e.g., "http://localhost:4096")
 * @param {object} [options] - Options
 * @param {string} [options.name] - Optional name for the worktree
 * @param {string} [options.startCommand] - Optional startup script to run after creation
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with { success, worktree?, error? }
 */
export async function createWorktree(serverUrl, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const body = {};
    if (options.name) body.name = options.name;
    if (options.startCommand) body.startCommand = options.startCommand;
    
    const response = await fetchFn(`${serverUrl}/experimental/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      debug(`createWorktree: ${serverUrl} returned ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Failed to create worktree: ${response.status} ${errorText}`,
      };
    }
    
    const worktree = await response.json();
    debug(`createWorktree: created worktree ${worktree.name} at ${worktree.directory}`);
    
    return {
      success: true,
      worktree,
    };
  } catch (err) {
    debug(`createWorktree: error - ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Get project info including sandboxes from the server
 * 
 * @param {string} serverUrl - OpenCode server URL
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object|null>} Project info or null if unavailable
 */
export async function getProjectInfo(serverUrl, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const response = await fetchFn(`${serverUrl}/project/current`);
    
    if (!response.ok) {
      debug(`getProjectInfo: ${serverUrl} returned ${response.status}`);
      return null;
    }
    
    const project = await response.json();
    debug(`getProjectInfo: project ${project.id} with ${project.sandboxes?.length || 0} sandboxes`);
    return project;
  } catch (err) {
    debug(`getProjectInfo: error - ${err.message}`);
    return null;
  }
}

/**
 * Get project info for a specific directory by querying all projects
 * 
 * @param {string} serverUrl - OpenCode server URL
 * @param {string} directory - Directory path to find project for
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object|null>} Project info or null if not found
 */
export async function getProjectInfoForDirectory(serverUrl, directory, options = {}) {
  const fetchFn = options.fetch || fetch;
  
  try {
    const response = await fetchFn(`${serverUrl}/project`);
    
    if (!response.ok) {
      debug(`getProjectInfoForDirectory: ${serverUrl} returned ${response.status}`);
      return null;
    }
    
    const projects = await response.json();
    
    // Find project matching this directory, preferring ones with sandboxes
    const matches = projects.filter(p => p.worktree === directory);
    
    if (matches.length === 0) {
      debug(`getProjectInfoForDirectory: no project found for ${directory}`);
      return null;
    }
    
    // Prefer the project with sandboxes (if multiple exist for same worktree)
    const withSandboxes = matches.find(p => p.sandboxes?.length > 0);
    const project = withSandboxes || matches[0];
    
    debug(`getProjectInfoForDirectory: found project ${project.id} for ${directory} with ${project.sandboxes?.length || 0} sandboxes`);
    return project;
  } catch (err) {
    debug(`getProjectInfoForDirectory: error - ${err.message}`);
    return null;
  }
}

/**
 * Resolve the working directory based on worktree configuration
 * 
 * Uses OpenCode's experimental worktree API:
 * - GET /experimental/worktree - List existing worktrees
 * - POST /experimental/worktree - Create new worktree
 * 
 * @param {string} serverUrl - OpenCode server URL
 * @param {string} baseDir - Base working directory from config
 * @param {object} worktreeConfig - Worktree configuration
 * @param {string} [worktreeConfig.worktree] - Worktree mode: "new" or worktree name
 * @param {string} [worktreeConfig.worktreeName] - Name for new worktree (only with "new")
 * @param {object} [options] - Options
 * @param {function} [options.fetch] - Custom fetch function (for testing)
 * @returns {Promise<object>} Result with { directory, worktreeCreated?, error? }
 */
export async function resolveWorktreeDirectory(serverUrl, baseDir, worktreeConfig, options = {}) {
  // No worktree config - use base directory
  if (!worktreeConfig?.worktree) {
    return { directory: baseDir };
  }
  
  // Require server for any worktree operation
  if (!serverUrl) {
    return {
      directory: baseDir,
      error: "Cannot use worktree: no server running",
    };
  }
  
  const worktreeValue = worktreeConfig.worktree;
  
  // "new" - create a fresh worktree via OpenCode API
  if (worktreeValue === "new") {
    const result = await createWorktree(serverUrl, {
      name: worktreeConfig.worktreeName,
      fetch: options.fetch,
    });
    
    if (!result.success) {
      return {
        directory: baseDir,
        error: result.error,
      };
    }
    
    return {
      directory: result.worktree.directory,
      worktreeCreated: true,
      worktree: result.worktree,
    };
  }
  
  // Named worktree - look it up from available sandboxes via OpenCode API
  const worktrees = await listWorktrees(serverUrl, options);
  const match = worktrees.find(w => w.includes(worktreeValue));
  if (match) {
    return { directory: match };
  }
  
  debug(`resolveWorktreeDirectory: worktree "${worktreeValue}" not found in available sandboxes`);
  
  // Fallback to base directory
  return {
    directory: baseDir,
    error: `Worktree "${worktreeValue}" not found in project sandboxes`,
  };
}
