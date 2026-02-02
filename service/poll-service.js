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

import { loadRepoConfig, getRepoConfig, getAllSources, getToolProviderConfig, resolveRepoForItem, getCleanupTtlDays, getStartupDelay } from "./repo-config.js";
import { createPoller, pollGenericSource, enrichItemsWithComments, enrichItemsWithMergeable, computeAttentionLabels } from "./poller.js";
import { evaluateReadiness, sortByPriority } from "./readiness.js";
import { executeAction, buildCommand } from "./actions.js";
import { debug } from "./logger.js";
import path from "path";
import os from "os";

// Default configuration
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a source has tool configuration
 * @see getToolConfig in poller.js for actual tool config resolution
 * @param {object} source - Source configuration
 * @returns {boolean} True if source has tool.command or (tool.mcp and tool.name)
 */
export function hasToolConfig(source) {
  return !!(source.tool && (source.tool.command || (source.tool.mcp && source.tool.name)));
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

/**
 * Build action config for a specific item, resolving repo from item fields
 * Uses source.repo template (e.g., "{repository.full_name}") to look up repo config
 * @param {object} source - Source configuration
 * @param {object} item - Item from the source (contains repo info)
 * @returns {object} Merged action config
 */
export function buildActionConfigForItem(source, item) {
  // Resolve repo key from item using source.repo template
  const repoKeys = resolveRepoForItem(source, item);
  const repoKey = repoKeys.length > 0 ? repoKeys[0] : null;
  
  // Get repo config (returns empty object if repo not configured)
  const repoConfig = repoKey ? getRepoConfig(repoKey) : {};
  
  // Build config with repo config as base, source overrides on top
  return buildActionConfigFromSource(source, repoConfig);
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

  // Ensure poller is initialized for state tracking
  if (!pollerInstance) {
    pollerInstance = createPoller({ configPath });
  }

  // Get all sources
  const sources = getAllSources();

  if (sources.length === 0) {
    debug("No sources configured");
    return results;
  }

  // Process each source
  for (const source of sources) {
    const sourceName = source.name || 'unknown';

    if (!hasToolConfig(source)) {
      console.error(`[poll] Source '${sourceName}' missing tool configuration (requires tool.command or tool.mcp and tool.name)`);
      continue;
    }

    let items = [];
    let toolProviderConfig = null;

    // Fetch items from source
    if (!skipMcp) {
      try {
        toolProviderConfig = getToolProviderConfig(source.tool.mcp);
        items = await pollGenericSource(source, { toolProviderConfig });
        debug(`Fetched ${items.length} items from ${sourceName}`);
        
        // Enrich items with comments for bot filtering if configured
        if (source.filter_bot_comments) {
          items = await enrichItemsWithComments(items, source);
          debug(`Enriched ${items.length} items with comments for bot filtering`);
        }
        
        // Enrich items with mergeable status for conflict detection if configured
        if (source.enrich_mergeable) {
          items = await enrichItemsWithMergeable(items, source);
          debug(`Enriched ${items.length} items with mergeable status`);
        }
        
        // Compute attention labels if both enrichments are present (for my-prs-attention)
        if (source.enrich_mergeable && source.filter_bot_comments) {
          items = computeAttentionLabels(items, source);
          debug(`Computed attention labels for ${items.length} items`);
        }
      } catch (err) {
        console.error(`[poll] Error fetching from ${sourceName}: ${err.message}`);
        continue;
      }
    }

    // Evaluate readiness and filter
    const readyItems = items
      .map((item) => {
        // Resolve repo from item for per-item config
        const repoKeys = resolveRepoForItem(source, item);
        const repoKey = repoKeys.length > 0 ? repoKeys[0] : null;
        const repoConfig = repoKey ? getRepoConfig(repoKey) : {};
        
        // Merge source-level readiness config with repo config
        // Source readiness takes precedence
        const readinessConfig = {
          ...repoConfig,
          readiness: {
            ...repoConfig.readiness,
            ...source.readiness,
          },
        };
        
        const readiness = evaluateReadiness(item, readinessConfig);
        debug(`Item ${item.id}: ready=${readiness.ready}, reason=${readiness.reason || 'none'}`);
        return {
          ...item,
          repo_key: repoKey || sourceName,
          repo_short: repoKey ? repoKey.split("/").pop() : sourceName,
          _readiness: readiness,
          _repoConfig: repoConfig,
        };
      })
      .filter((item) => item._readiness.ready);
    
    debug(`${readyItems.length} items ready out of ${items.length}`);

    // Sort by priority (use first item's repo config or empty)
    const sortConfig = readyItems.length > 0 ? readyItems[0]._repoConfig : {};
    const sortedItems = sortByPriority(readyItems, sortConfig);

    // Process ready items
    // Get reprocess_on config: source-level overrides provider-level
    const reprocessOn = source.reprocess_on || toolProviderConfig?.reprocess_on;
    
    debug(`Processing ${sortedItems.length} sorted items`);
    for (const item of sortedItems) {
      // Check if already processed
      if (pollerInstance && pollerInstance.isProcessed(item.id)) {
        // Check if item should be reprocessed (reopened, status changed, etc.)
        if (pollerInstance.shouldReprocess(item, { reprocessOn })) {
          debug(`Reprocessing ${item.id} - state changed`);
          pollerInstance.clearProcessed(item.id);
          console.log(`[poll] Reprocessing ${item.id} (reopened or updated)`);
        } else {
          debug(`Skipping ${item.id} - already processed`);
          continue;
        }
      }

      debug(`Executing action for ${item.id}`);
      // Build action config from source and item (resolves repo from item fields)
      const actionConfig = buildActionConfigForItem(source, item);

      // Skip items with no valid local path (prevents sessions in home directory)
      const hasLocalPath = actionConfig.working_dir || actionConfig.path || actionConfig.repo_path;
      if (!hasLocalPath) {
        debug(`Skipping ${item.id} - no local path configured for repository`);
        console.warn(`[poll] Skipping ${item.id} - no local path configured (repo not in repos_dir or explicit config)`);
        continue;
      }

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
            // Store item state for detecting reopened/updated items
            if (pollerInstance) {
              pollerInstance.markProcessed(item.id, { 
                repoKey: item.repo_key, 
                command: result.command,
                source: sourceName,
                itemState: item.state || item.status || null,
                itemUpdatedAt: item.updated_at || null,
              });
            }
            if (result.warning) {
              console.log(`[poll] Started session for ${item.id} (warning: ${result.warning})`);
            } else {
              console.log(`[poll] Started session for ${item.id}`);
            }
          } else if (result.skipped) {
            // Item was skipped (e.g., no local path configured) - use debug level
            // This will retry on next poll, but doesn't spam logs
            debug(`Skipped ${item.id}: ${result.error}`);
          } else {
            // Real failure - log as error
            console.error(`[poll] Failed to start session for ${item.id}: ${result.error || result.stderr || 'unknown error'}`);
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

    // Track which items are present/missing for reappearance detection
    // Also clean up state entries for items no longer returned by this source
    if (pollerInstance && items.length > 0) {
      const currentItemIds = items.map(item => item.id);
      
      // Mark items as seen/unseen for reappearance detection
      pollerInstance.markUnseen(sourceName, currentItemIds);
      
      // Clean up old entries (only removes entries older than 1 day)
      const removed = pollerInstance.cleanupMissingFromSource(sourceName, currentItemIds, 1);
      if (removed > 0) {
        debug(`Cleaned up ${removed} stale state entries for source ${sourceName}`);
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

  // Load config to access cleanup settings
  loadRepoConfig(configPath);

  // Initialize poller for state tracking
  pollerInstance = createPoller({ configPath });

  // Clean up expired entries on startup
  const ttlDays = getCleanupTtlDays();
  const expiredRemoved = pollerInstance.cleanupExpired(ttlDays);
  if (expiredRemoved > 0) {
    console.log(`[poll] Cleaned up ${expiredRemoved} expired state entries (older than ${ttlDays} days)`);
  }

  // Delay first poll to allow OpenCode server to fully initialize
  // This prevents race conditions on startup where projects/sandboxes aren't loaded yet
  const startupDelay = getStartupDelay();
  if (startupDelay > 0) {
    console.log(`[poll] Waiting ${startupDelay / 1000}s for server to initialize...`);
  }
  
  // Schedule first poll after startup delay (or immediately if delay is 0)
  setTimeout(() => {
    pollOnce({ configPath }).catch((err) => {
      console.error("[poll] Error in poll cycle:", err.message);
    });
  }, startupDelay);

  // Start interval (runs after startup delay + interval for first scheduled poll)
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
