/**
 * poller.js - MCP-based polling for automation sources
 *
 * Connects to MCP servers (GitHub, Linear) to fetch items for automation.
 * Tracks processed items to avoid duplicate handling.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import fs from "fs";
import path from "path";
import os from "os";
import { getNestedValue } from "./utils.js";

/**
 * Expand template string with item fields
 * Supports {field} and {field.nested} syntax
 * @param {string} template - Template with {placeholders}
 * @param {object} item - Item with fields to substitute
 * @returns {string} Expanded string
 */
export function expandItemId(template, item) {
  return template.replace(/\{([^}]+)\}/g, (match, fieldPath) => {
    const value = getNestedValue(item, fieldPath);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Apply field mappings to an item
 * Mappings define how to map source fields to standard fields
 * 
 * Supports:
 * - Simple path: "fieldName" or "nested.field.path"
 * - Regex extraction: "url:/issue/([A-Z]+-\d+)/" extracts from url field using regex
 * 
 * @param {object} item - Raw item from MCP tool
 * @param {object|null} mappings - Field mappings { targetField: "source.field.path" }
 * @returns {object} Item with mapped fields added (original fields preserved)
 */
export function applyMappings(item, mappings) {
  if (!mappings) return item;

  const result = { ...item };

  for (const [targetField, sourcePath] of Object.entries(mappings)) {
    // Check for regex extraction syntax: "field:/regex/"
    const regexMatch = sourcePath.match(/^(\w+):\/(.+)\/$/);
    if (regexMatch) {
      const [, field, pattern] = regexMatch;
      const fieldValue = getNestedValue(item, field);
      if (fieldValue) {
        const regex = new RegExp(pattern);
        const match = String(fieldValue).match(regex);
        result[targetField] = match ? (match[1] || match[0]) : undefined;
      }
    } else {
      // Simple field path
      result[targetField] = getNestedValue(item, sourcePath);
    }
  }

  return result;
}

/**
 * Get tool configuration from a source
 * @param {object} source - Source configuration from config.yaml
 * @returns {object} Tool configuration
 */
export function getToolConfig(source) {
  if (!source.tool || !source.tool.mcp || !source.tool.name) {
    throw new Error(`Source '${source.name || 'unknown'}' missing tool configuration (requires tool.mcp and tool.name)`);
  }

  return {
    mcpServer: source.tool.mcp,
    toolName: source.tool.name,
    args: source.args || {},
    idTemplate: source.item?.id || null,
  };
}

/**
 * Transform items by adding IDs using template
 * @param {Array} items - Raw items from MCP tool
 * @param {string|null} idTemplate - Template for generating IDs
 * @returns {Array} Items with id field added
 */
export function transformItems(items, idTemplate) {
  let counter = 0;
  return items.map((item) => {
    let id;
    if (idTemplate) {
      id = expandItemId(idTemplate, item);
    } else if (item.id) {
      id = item.id;
    } else {
      // Generate a fallback ID
      id = `item-${Date.now()}-${counter++}`;
    }
    return { ...item, id };
  });
}

/**
 * Parse JSON text as an array with error handling
 * @param {string} text - JSON text to parse
 * @param {string} sourceName - Source name for error logging
 * @param {string} [responseKey] - Key to extract array from response object
 * @returns {Array} Parsed array of items
 */
export function parseJsonArray(text, sourceName, responseKey) {
  try {
    const data = JSON.parse(text);
    
    // If already an array, return it
    if (Array.isArray(data)) return data;
    
    // If response_key is configured, use it to extract the array
    if (responseKey) {
      const items = data[responseKey];
      if (Array.isArray(items)) return items;
      // response_key was specified but not found or not an array
      console.error(`[poller] Response key '${responseKey}' not found or not an array in ${sourceName} response`);
      return [];
    }
    
    // No response_key - wrap single object as array
    return [data];
  } catch (err) {
    console.error(`[poller] Failed to parse ${sourceName} response:`, err.message);
    return [];
  }
}

/**
 * Expand environment variables in a string
 */
function expandEnvVars(str) {
  return str.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");
}

/**
 * Create appropriate transport based on MCP config
 */
async function createTransport(mcpConfig) {
  const headers = {};
  if (mcpConfig.headers) {
    for (const [key, value] of Object.entries(mcpConfig.headers)) {
      headers[key] = expandEnvVars(value);
    }
  }

  if (mcpConfig.type === "remote") {
    const url = new URL(mcpConfig.url);
    if (mcpConfig.url.includes("linear.app/sse")) {
      return new SSEClientTransport(url, { requestInit: { headers } });
    } else {
      return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    }
  } else if (mcpConfig.type === "local") {
    const command = mcpConfig.command;
    if (!command || command.length === 0) {
      throw new Error("Local MCP config missing command");
    }
    const [cmd, ...args] = command;
    return new StdioClientTransport({
      command: cmd,
      args,
      env: { ...process.env },
    });
  }

  throw new Error(`Unknown MCP type: ${mcpConfig.type}`);
}

/**
 * Get MCP config from opencode.json
 */
function getMcpConfig(serverName, configPath) {
  const actualPath = configPath || path.join(os.homedir(), ".config/opencode/opencode.json");
  
  if (!fs.existsSync(actualPath)) {
    throw new Error(`MCP config not found: ${actualPath}`);
  }

  const config = JSON.parse(fs.readFileSync(actualPath, "utf-8"));
  const mcpConfig = config.mcp?.[serverName];

  if (!mcpConfig) {
    throw new Error(`MCP server '${serverName}' not configured`);
  }

  if (mcpConfig.enabled === false) {
    throw new Error(`MCP server '${serverName}' is disabled`);
  }

  return mcpConfig;
}

// Default timeout for MCP connections (30 seconds)
const DEFAULT_MCP_TIMEOUT = 30000;

/**
 * Create a timeout promise that rejects after specified ms
 */
function createTimeout(ms, operation) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
  });
}

/**
 * Poll a source using MCP tools
 * 
 * @param {object} source - Source configuration from config.yaml
 * @param {object} [options] - Additional options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @param {string} [options.opencodeConfigPath] - Path to opencode.json for MCP config
 * @param {object} [options.toolProviderConfig] - Tool provider config (response_key, mappings)
 * @returns {Promise<Array>} Array of items from the source with IDs and mappings applied
 */
export async function pollGenericSource(source, options = {}) {
  const toolConfig = getToolConfig(source);
  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  const toolProviderConfig = options.toolProviderConfig || {};
  const responseKey = toolProviderConfig.response_key;
  const mappings = toolProviderConfig.mappings || null;
  const mcpConfig = getMcpConfig(toolConfig.mcpServer, options.opencodeConfigPath);
  const client = new Client({ name: "opencode-pilot", version: "1.0.0" });

  try {
    const transport = await createTransport(mcpConfig);
    
    // Connect with timeout
    await Promise.race([
      client.connect(transport),
      createTimeout(timeout, "MCP connection"),
    ]);

    // Call the tool directly with provided args
    const result = await Promise.race([
      client.callTool({ name: toolConfig.toolName, arguments: toolConfig.args }),
      createTimeout(timeout, "callTool"),
    ]);

    // Parse the response
    const text = result.content?.[0]?.text;
    if (!text) return [];
    
    const rawItems = parseJsonArray(text, source.name, responseKey);
    
    // Apply field mappings before transforming
    const mappedItems = mappings 
      ? rawItems.map(item => applyMappings(item, mappings))
      : rawItems;
    
    // Transform items (add IDs)
    return transformItems(mappedItems, toolConfig.idTemplate);
  } finally {
    try {
      // Close with timeout to prevent hanging on unresponsive MCP servers
      await Promise.race([
        client.close(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Create a poller instance with state tracking
 * 
 * @param {object} options - Poller options
 * @param {string} [options.stateFile] - Path to state file for tracking processed items
 * @param {string} [options.configPath] - Path to opencode.json
 * @returns {object} Poller instance
 */
export function createPoller(options = {}) {
  const stateFile = options.stateFile || path.join(os.homedir(), '.config/opencode-pilot/poll-state.json');
  const configPath = options.configPath;
  
  // Load existing state
  let processedItems = new Map();
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (state.processed) {
        processedItems = new Map(Object.entries(state.processed));
      }
    } catch {
      // Start fresh if state is corrupted
    }
  }
  
  function saveState() {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const state = {
      processed: Object.fromEntries(processedItems),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
  
  return {
    /**
     * Check if an item has been processed
     */
    isProcessed(itemId) {
      return processedItems.has(itemId);
    },
    
    /**
     * Mark an item as processed
     */
    markProcessed(itemId, metadata = {}) {
      processedItems.set(itemId, {
        processedAt: new Date().toISOString(),
        ...metadata,
      });
      saveState();
    },
    
    /**
     * Clear a specific item from processed state
     */
    clearProcessed(itemId) {
      processedItems.delete(itemId);
      saveState();
    },
    
    /**
     * Clear all processed state
     */
    clearState() {
      processedItems.clear();
      saveState();
    },
    
    /**
     * Get all processed item IDs
     */
    getProcessedIds() {
      return Array.from(processedItems.keys());
    },
    
    /**
     * Get count of processed items, optionally filtered by source
     * @param {string} [sourceName] - Optional source filter
     * @returns {number} Count of entries
     */
    getProcessedCount(sourceName) {
      if (!sourceName) return processedItems.size;
      let count = 0;
      for (const [, meta] of processedItems) {
        if (meta.source === sourceName) count++;
      }
      return count;
    },
    
    /**
     * Clear all entries for a specific source
     * @param {string} sourceName - Source name
     * @returns {number} Number of entries removed
     */
    clearBySource(sourceName) {
      let removed = 0;
      for (const [id, meta] of processedItems) {
        if (meta.source === sourceName) {
          processedItems.delete(id);
          removed++;
        }
      }
      if (removed > 0) saveState();
      return removed;
    },
    
    /**
     * Remove entries older than ttlDays
     * @param {number} [ttlDays=30] - Days before expiration
     * @returns {number} Number of entries removed
     */
    cleanupExpired(ttlDays = 30) {
      const cutoffMs = Date.now() - (ttlDays * 24 * 60 * 60 * 1000);
      let removed = 0;
      for (const [id, meta] of processedItems) {
        const processedAt = new Date(meta.processedAt).getTime();
        if (processedAt < cutoffMs) {
          processedItems.delete(id);
          removed++;
        }
      }
      if (removed > 0) saveState();
      return removed;
    },
    
    /**
     * Remove entries for a source that are no longer in current items
     * Only removes entries older than minAgeDays to avoid race conditions
     * @param {string} sourceName - Source name to clean
     * @param {string[]} currentItemIds - Current item IDs from source
     * @param {number} [minAgeDays=1] - Minimum age before cleanup (0 = immediate)
     * @returns {number} Number of entries removed
     */
    cleanupMissingFromSource(sourceName, currentItemIds, minAgeDays = 1) {
      const currentSet = new Set(currentItemIds);
      // Timestamp cutoff: entries processed before this time are eligible for cleanup
      const cutoffTimestamp = Date.now() - (minAgeDays * 24 * 60 * 60 * 1000);
      let removed = 0;
      for (const [id, meta] of processedItems) {
        if (meta.source === sourceName && !currentSet.has(id)) {
          const processedAt = new Date(meta.processedAt).getTime();
          // Use <= to allow immediate cleanup when minAgeDays=0
          if (processedAt <= cutoffTimestamp) {
            processedItems.delete(id);
            removed++;
          }
        }
      }
      if (removed > 0) saveState();
      return removed;
    },
    
    /**
     * Check if an item should be reprocessed based on state changes
     * Returns true if:
     * - Item was reopened (closed/merged -> open)
     * - Item status changed (for Linear: Done -> In Progress)
     * - Item was updated after being processed
     * @param {object} item - Current item from source
     * @returns {boolean} True if item should be reprocessed
     */
    shouldReprocess(item) {
      if (!item.id) return false;
      
      const meta = processedItems.get(item.id);
      if (!meta) return false; // Not processed before
      if (!meta.itemState) return false; // No state tracking (legacy entry)
      
      // Get current state from item (GitHub uses 'state', Linear uses 'status')
      const currentState = item.state || item.status;
      if (!currentState) return false;
      
      // Check if state changed from closed/done to open/in-progress
      const storedState = meta.itemState.toLowerCase();
      const newState = currentState.toLowerCase();
      
      // Reopened: was closed/merged, now open
      if ((storedState === 'closed' || storedState === 'merged' || storedState === 'done') 
          && (newState === 'open' || newState === 'in progress')) {
        return true;
      }
      
      // Check updated_at timestamp if available
      if (meta.itemUpdatedAt && item.updated_at) {
        const storedUpdatedAt = new Date(meta.itemUpdatedAt).getTime();
        const currentUpdatedAt = new Date(item.updated_at).getTime();
        if (currentUpdatedAt > storedUpdatedAt) {
          return true;
        }
      }
      
      return false;
    },
  };
}
