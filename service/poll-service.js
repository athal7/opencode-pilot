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

import { loadRepoConfig, getRepoConfig, getAllSources, getToolMappings } from "./repo-config.js";
import { createPoller, pollGenericSource } from "./poller.js";
import { evaluateReadiness, sortByPriority } from "./readiness.js";
import { executeAction, buildCommand } from "./actions.js";
import { debug } from "./logger.js";
import path from "path";
import os from "os";

// Default configuration
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a source has tool configuration
 * @param {object} source - Source configuration
 * @returns {boolean} True if source has tool.mcp and tool.name
 */
export function hasToolConfig(source) {
  return !!(source.tool && source.tool.mcp && source.tool.name);
}

/**
 * Build action config from source and repo config
 * Source fields override repo config fields
 * @param {object} source - Source configuration
 * @param {object} repoConfig - Repository configuration
 * @returns {object} Merged action config
 */
export function buildActionConfigFromSource(source, repoConfig) {
  return {
    // Repo config as base
    ...repoConfig,
    // Normalize path to repo_path
    repo_path: source.working_dir || repoConfig.path || repoConfig.repo_path,
    // Session from source or repo
    session: source.session || repoConfig.session || {},
    // Source-level overrides (highest priority)
    ...(source.prompt && { prompt: source.prompt }),
    ...(source.agent && { agent: source.agent }),
    ...(source.model && { model: source.model }),
    ...(source.working_dir && { working_dir: source.working_dir }),
  };
}

// Global state
let pollingInterval = null;
let pollerInstance = null;

/**
 * Run a single poll cycle
 * @param {object} options - Poll options
 * @param {boolean} [options.dryRun] - If true, don't execute actions
 * @param {boolean} [options.skipMcp] - If true, skip MCP fetching (for testing)
 * @param {string} [options.configPath] - Path to config.yaml
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
    debug("No sources configured");
    return results;
  }

  // Process each source
  for (const source of sources) {
    const sourceName = source.name || 'unknown';
    const repoKey = source.name || 'default';
    const repoConfig = getRepoConfig(repoKey) || {};

    if (!hasToolConfig(source)) {
      console.error(`[poll] Source '${sourceName}' missing tool configuration (requires tool.mcp and tool.name)`);
      continue;
    }

    let items = [];

    // Fetch items from source
    if (!skipMcp) {
      try {
        const mappings = getToolMappings(source.tool.mcp);
        items = await pollGenericSource(source, { mappings });
        debug(`Fetched ${items.length} items from ${sourceName}`);
      } catch (err) {
        console.error(`[poll] Error fetching from ${sourceName}: ${err.message}`);
        continue;
      }
    }

    // Evaluate readiness and filter
    const readyItems = items
      .map((item) => {
        const readiness = evaluateReadiness(item, repoConfig);
        debug(`Item ${item.id}: ready=${readiness.ready}, reason=${readiness.reason || 'none'}`);
        return {
          ...item,
          repo_key: repoKey,
          repo_short: repoKey.split("/").pop(),
          _readiness: readiness,
        };
      })
      .filter((item) => item._readiness.ready);
    
    debug(`${readyItems.length} items ready out of ${items.length}`);

    // Sort by priority
    const sortedItems = sortByPriority(readyItems, repoConfig);

    // Process ready items
    debug(`Processing ${sortedItems.length} sorted items`);
    for (const item of sortedItems) {
      // Check if already processed
      if (pollerInstance && pollerInstance.isProcessed(item.id)) {
        debug(`Skipping ${item.id} - already processed`);
        continue;
      }

      debug(`Executing action for ${item.id}`);
      // Build action config from source (includes agent, model, prompt, working_dir)
      const actionConfig = buildActionConfigFromSource(source, repoConfig);

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
 * @param {string} [options.configPath] - Path to config.yaml
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
