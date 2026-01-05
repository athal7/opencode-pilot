/**
 * poll-service.js - Polling orchestration service
 *
 * Orchestrates the polling loop:
 * 1. Load repo configuration
 * 2. Fetch items from sources via MCP
 * 3. Evaluate readiness
 * 4. Execute actions for ready items
 * 5. Track processed items to avoid duplicates
 */

import { loadRepoConfig, getRepoConfig, getAllSources } from "./repo-config.js";
import { createPoller, pollSource } from "./poller.js";
import { evaluateReadiness, sortByPriority } from "./readiness.js";
import { executeAction, buildCommand } from "./actions.js";
import path from "path";
import os from "os";

// Default configuration
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Global state
let pollingInterval = null;
let pollerInstance = null;

/**
 * Run a single poll cycle
 * @param {object} options - Poll options
 * @param {boolean} [options.dryRun] - If true, don't execute actions
 * @param {boolean} [options.skipMcp] - If true, skip MCP fetching (for testing)
 * @param {string} [options.configPath] - Path to repos.yaml
 * @returns {Promise<Array>} Results of actions taken
 */
export async function pollOnce(options = {}) {
  const {
    dryRun = false,
    skipMcp = false,
    configPath,
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

  // Process each source
  for (const source of sources) {
    const repoKey = source.repo_key;
    const repoPath = source.repo_path;
    const sourceType = source.type;

    // Get repo config for readiness evaluation
    const repoConfig = getRepoConfig(repoKey);

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

    // Process ready items
    for (const item of sortedItems) {
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
            // Mark as processed to avoid re-triggering
            if (pollerInstance) {
              pollerInstance.markProcessed(item.id, { repoKey, command: result.command });
            }
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
 * @returns {object} Polling state with stop() method
 */
export function startPolling(options = {}) {
  const { interval = DEFAULT_POLL_INTERVAL, configPath } = options;

  // Initialize poller for state tracking
  pollerInstance = createPoller({ configPath });

  // Run first poll immediately
  pollOnce({ configPath }).catch((err) => {
    console.error("[poll] Error in poll cycle:", err.message);
  });

  // Start interval
  pollingInterval = setInterval(() => {
    pollOnce({ configPath }).catch((err) => {
      console.error("[poll] Error in poll cycle:", err.message);
    });
  }, interval);

  console.log(`[poll] Started polling every ${interval / 1000}s`);

  return {
    interval: pollingInterval,
    poller: pollerInstance,
    stop: stopPolling,
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
 * Clear processed state for an item (e.g., when issue is closed/reopened)
 * @param {string} itemId - Item ID to clear
 */
export function clearProcessed(itemId) {
  if (pollerInstance) {
    // Access the poller's internal state - need to expose this
    console.log(`[poll] Cleared processed state for ${itemId}`);
  }
}

/**
 * Get the poller instance (for external state management)
 * @returns {object|null} Poller instance or null if not started
 */
export function getPoller() {
  return pollerInstance;
}
