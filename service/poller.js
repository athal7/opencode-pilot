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
 */
function parseJsonArray(text, sourceName) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (data.items) return data.items;
    if (data.issues) return data.issues;
    if (data.nodes) return data.nodes;
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
 * @param {object} [options.mappings] - Field mappings to apply to items
 * @returns {Promise<Array>} Array of items from the source with IDs and mappings applied
 */
export async function pollGenericSource(source, options = {}) {
  const toolConfig = getToolConfig(source);
  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  const mappings = options.mappings || null;
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
    
    const rawItems = parseJsonArray(text, source.name);
    
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
  };
}
