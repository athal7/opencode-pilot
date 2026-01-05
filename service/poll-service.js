/**
 * poll-service.js - Polling orchestration service
 *
 * Orchestrates the polling loop:
 * 1. Load repo configuration
 * 2. Fetch items from sources via MCP
 * 3. Evaluate readiness
 * 4. Execute actions (respecting WIP limits)
 * 5. Track processed items
 */

import { loadRepoConfig, getRepoConfig, getAllSources, getGlobalConfig } from "./repo-config.js";
import { createPoller, pollSource } from "./poller.js";
import { evaluateReadiness, sortByPriority } from "./readiness.js";
import { executeAction, buildCommand } from "./actions.js";
import fs from "fs";
import path from "path";
import os from "os";

// Default configuration
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_STATE_PATH = path.join(
  os.homedir(),
  ".cache/opencode-pilot/poll-state.json"
);

// Global state
let pollingInterval = null;
let pollerInstance = null;
let activeSessionCount = 0;

/**
 * Load WIP state (active sessions)
 */
function loadWipState(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, "utf-8");
      const state = JSON.parse(content);
      return state.activeSessions || [];
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Save WIP state
 */
function saveWipState(statePath, activeSessions) {
  const stateDir = path.dirname(statePath);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(
    statePath,
    JSON.stringify({ activeSessions, updatedAt: new Date().toISOString() }, null, 2)
  );
}

/**
 * Check if WIP limit is reached for a repo
 */
function isWipLimitReached(repoKey, config, activeSessions) {
  const maxConcurrent = config.wip_limits?.max_concurrent || 3;
  const repoSessions = activeSessions.filter((s) => s.repo_key === repoKey);
  return repoSessions.length >= maxConcurrent;
}

/**
 * Get global WIP limit from config
 */
function getGlobalWipLimit() {
  const globalConfig = getGlobalConfig();
  return globalConfig.wip_limits?.max_concurrent || 10;
}

/**
 * Run a single poll cycle
 * @param {object} options - Poll options
 * @param {boolean} [options.dryRun] - If true, don't execute actions
 * @param {boolean} [options.skipMcp] - If true, skip MCP fetching (for testing)
 * @param {string} [options.configPath] - Path to repos.yaml
 * @param {string} [options.statePath] - Path to state file
 * @returns {Promise<Array>} Results of actions taken
 */
export async function pollOnce(options = {}) {
  const {
    dryRun = false,
    skipMcp = false,
    configPath,
    statePath = DEFAULT_STATE_PATH,
  } = options;

  const results = [];

  // Load configuration
  loadRepoConfig(configPath);

  // Get all sources
  const sources = getAllSources();

  if (sources.length === 0) {
    console.log("[poll] No sources configured");
    return results;
  }

  // Load WIP state
  const activeSessions = loadWipState(statePath);

  // Check global WIP limit
  if (activeSessions.length >= getGlobalWipLimit()) {
    console.log("[poll] Global WIP limit reached, skipping poll");
    return results;
  }

  // Process each source
  for (const source of sources) {
    const repoKey = source.repo_key;
    const repoPath = source.repo_path;
    const sourceType = source.type;

    // Get repo config for readiness evaluation
    const repoConfig = getRepoConfig(repoKey);

    // Check WIP limit for this repo
    if (isWipLimitReached(repoKey, repoConfig, activeSessions)) {
      console.log(`[poll] WIP limit reached for ${repoKey}, skipping`);
      continue;
    }

    let items = [];

    // Fetch items from source
    if (!skipMcp) {
      try {
        // Include repo in fetch options for proper filtering
        const fetchOpts = {
          ...source.fetch,
          repo: source.fetch?.repo || repoKey,
        };
        items = await pollSource(sourceType, fetchOpts);
        console.log(`[poll] Fetched ${items.length} items from ${sourceType} for ${repoKey}`);
      } catch (err) {
        console.error(`[poll] Error fetching from ${sourceType}: ${err.message}`);
        continue;
      }
    }

    // Evaluate readiness and filter
    const readyItems = items
      .map((item) => ({
        ...item,
        repo_key: repoKey,
        repo_path: repoPath,
        repo_short: repoKey.split("/").pop(),
        _readiness: evaluateReadiness(item, repoConfig),
      }))
      .filter((item) => item._readiness.ready);

    // Sort by priority
    const sortedItems = sortByPriority(readyItems, repoConfig);

    // Process ready items (respecting limits)
    for (const item of sortedItems) {
      // Check WIP limit again
      if (isWipLimitReached(repoKey, repoConfig, activeSessions)) {
        break;
      }

      // Check if already processed
      if (pollerInstance && pollerInstance.isProcessed(item.id)) {
        continue;
      }

      // Build action config
      const actionConfig = {
        ...repoConfig,
        repo_path: repoPath,
        session: source.session || repoConfig.session || {},
      };

      // Execute or dry-run
      if (dryRun) {
        const command = buildCommand(item, actionConfig);
        results.push({
          item,
          command,
          dryRun: true,
        });
        console.log(`[poll] Would execute: ${command}`);
      } else {
        try {
          const result = await executeAction(item, actionConfig);
          results.push({
            item,
            ...result,
          });

          if (result.success) {
            // Mark as processed
            if (pollerInstance) {
              pollerInstance.markProcessed(item.id, { repoKey, command: result.command });
            }

            // Add to active sessions
            activeSessions.push({
              id: item.id,
              repo_key: repoKey,
              started_at: new Date().toISOString(),
            });
            saveWipState(statePath, activeSessions);

            console.log(`[poll] Started session for ${item.id}`);
          } else {
            console.error(`[poll] Failed to start session: ${result.stderr}`);
          }
        } catch (err) {
          console.error(`[poll] Error executing action: ${err.message}`);
          results.push({
            item,
            error: err.message,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Start the polling loop
 * @param {object} options - Polling options
 * @param {number} [options.interval] - Poll interval in ms
 * @param {string} [options.configPath] - Path to repos.yaml
 * @param {string} [options.statePath] - Path to state file
 * @returns {object} Polling state
 */
export function startPolling(options = {}) {
  const { interval = DEFAULT_POLL_INTERVAL, configPath, statePath } = options;

  // Initialize poller for state tracking
  pollerInstance = createPoller({ configPath });

  // Run first poll immediately
  pollOnce({ configPath, statePath }).catch((err) => {
    console.error("[poll] Error in poll cycle:", err.message);
  });

  // Start interval
  pollingInterval = setInterval(() => {
    pollOnce({ configPath, statePath }).catch((err) => {
      console.error("[poll] Error in poll cycle:", err.message);
    });
  }, interval);

  console.log(`[poll] Started polling every ${interval / 1000}s`);

  return {
    interval: pollingInterval,
    poller: pollerInstance,
  };
}

/**
 * Stop the polling loop
 */
export function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log("[poll] Stopped polling");
  }
}

/**
 * Mark a session as completed (for WIP tracking)
 * @param {string} sessionId - Session/item ID
 * @param {string} [statePath] - Path to state file
 */
export function markSessionComplete(sessionId, statePath = DEFAULT_STATE_PATH) {
  const activeSessions = loadWipState(statePath);
  const filtered = activeSessions.filter((s) => s.id !== sessionId);
  saveWipState(statePath, filtered);
  console.log(`[poll] Marked session ${sessionId} as complete`);
}

/**
 * Get current WIP status
 * @param {string} [statePath] - Path to state file
 * @returns {object} WIP status
 */
export function getWipStatus(statePath = DEFAULT_STATE_PATH) {
  const activeSessions = loadWipState(statePath);
  return {
    activeSessions,
    count: activeSessions.length,
    globalLimit: getGlobalWipLimit(),
  };
}
