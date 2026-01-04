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

// Source type to MCP server mapping
const SOURCE_TO_MCP = {
  github_issue: "github",
  github_pr: "github",
  linear_issue: "linear",
};

// Tool mappings per source type
const TOOL_MAPPINGS = {
  github_issue: {
    tool: "search_issues",
    buildQuery: (opts) => {
      const parts = ["is:issue"];
      if (opts.assignee) parts.push(`assignee:${opts.assignee}`);
      if (opts.state) parts.push(`state:${opts.state}`);
      if (opts.repo) parts.push(`repo:${opts.repo}`);
      if (opts.org) parts.push(`org:${opts.org}`);
      if (opts.labels?.length)
        opts.labels.forEach((l) => parts.push(`label:${l}`));
      return { q: parts.join(" ") };
    },
    transform: (result) => {
      const text = result.content?.[0]?.text;
      if (!text) return [];
      const items = parseJsonArray(text, "github_issue");
      return items.map((item) => ({
        id: `github:${item.repository?.full_name || "unknown"}#${item.number}`,
        number: item.number,
        title: item.title,
        body: item.body,
        html_url: item.html_url || item.url,
        repository: {
          full_name:
            item.repository?.full_name ||
            `${item.repository?.owner?.login || item.repository?.owner}/${item.repository?.name}`,
          name: item.repository?.name,
        },
        labels: item.labels || [],
        assignees: item.assignees || [],
      }));
    },
  },
  github_pr: {
    tool: "search_issues",
    buildQuery: (opts) => {
      const parts = ["is:pr"];
      if (opts.review_requested)
        parts.push(`review-requested:${opts.review_requested}`);
      if (opts.state) parts.push(`state:${opts.state}`);
      if (opts.repo) parts.push(`repo:${opts.repo}`);
      if (opts.org) parts.push(`org:${opts.org}`);
      return { q: parts.join(" ") };
    },
    transform: (result) => {
      const text = result.content?.[0]?.text;
      if (!text) return [];
      const items = parseJsonArray(text, "github_pr");
      return items.map((item) => ({
        id: `github:${item.repository?.full_name || "unknown"}#${item.number}`,
        number: item.number,
        title: item.title,
        body: item.body,
        html_url: item.html_url || item.url,
        repository: {
          full_name: item.repository?.full_name,
          name: item.repository?.name,
        },
        labels: item.labels || [],
        headRefName: item.head?.ref || "",
      }));
    },
  },
  linear_issue: {
    tool: null,
    toolCandidates: [
      "list_my_issues",
      "get_my_issues",
      "search_issues",
      "list_issues",
      "linear_search_issues",
      "linear_list_issues",
    ],
    buildQuery: (opts) => {
      const query = {};
      if (opts.assignee === "@me") {
        query.assignedToMe = true;
      }
      if (Array.isArray(opts.state)) {
        query.status = opts.state;
      }
      return query;
    },
    transform: (result) => {
      const text = result.content?.[0]?.text;
      if (!text) return [];
      const items = parseJsonArray(text, "linear_issue");
      return items.map((item) => ({
        id: `linear:${item.identifier || item.id}`,
        identifier: item.identifier,
        title: item.title,
        description: item.description,
        url: item.url,
        team: item.team,
        labels: item.labels || [],
        state: item.state,
      }));
    },
  },
};

/**
 * Parse JSON text as an array with error handling
 */
function parseJsonArray(text, sourceType) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    console.error(
      `Warning: MCP response for ${sourceType} is not an array, returning empty`
    );
    return [];
  } catch (err) {
    console.error(
      `Warning: Failed to parse MCP response for ${sourceType}: ${err.message}`
    );
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
 * Poll a single source and return items
 * 
 * @param {string} sourceType - Source type (github_issue, github_pr, linear_issue)
 * @param {object} options - Fetch options for the source
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @param {string} [configPath] - Optional path to opencode.json
 * @returns {Promise<Array>} Array of items from the source
 */
export async function pollSource(sourceType, options = {}, configPath) {
  const mcpServerName = SOURCE_TO_MCP[sourceType];
  if (!mcpServerName) {
    throw new Error(`Unknown source type: ${sourceType}`);
  }

  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  const mcpConfig = getMcpConfig(mcpServerName, configPath);
  const client = new Client({ name: "opencode-pilot", version: "1.0.0" });
  let transport;

  try {
    transport = await createTransport(mcpConfig);
    
    // Connect with timeout
    await Promise.race([
      client.connect(transport),
      createTimeout(timeout, "MCP connection"),
    ]);

    const mapping = TOOL_MAPPINGS[sourceType];
    let toolName = mapping.tool;

    // Discover tool name if not fixed (with timeout)
    if (!toolName && mapping.toolCandidates) {
      const tools = await Promise.race([
        client.listTools(),
        createTimeout(timeout, "listTools"),
      ]);
      const availableNames = tools.tools.map((t) => t.name);
      toolName = mapping.toolCandidates.find((c) => availableNames.includes(c));

      if (!toolName) {
        throw new Error(
          `No matching tool found for ${sourceType}. Available: ${availableNames.join(", ")}`
        );
      }
    }

    const params = mapping.buildQuery(options);
    
    // Call tool with timeout
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: params }),
      createTimeout(timeout, "callTool"),
    ]);
    
    return mapping.transform(result);
  } finally {
    try {
      await client.close();
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
  const stateFile = options.stateFile || path.join(os.homedir(), ".cache/opencode-pilot/poll-state.json");
  const configPath = options.configPath;
  
  // Ensure state directory exists
  const stateDir = path.dirname(stateFile);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Load existing state
  let processed = {};
  if (fs.existsSync(stateFile)) {
    try {
      processed = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    } catch {
      processed = {};
    }
  }

  /**
   * Save state to file
   */
  function saveState() {
    fs.writeFileSync(stateFile, JSON.stringify(processed, null, 2));
  }

  /**
   * Check if an item has been processed
   */
  function isProcessed(itemId) {
    return !!processed[itemId];
  }

  /**
   * Mark an item as processed
   */
  function markProcessed(itemId, metadata = {}) {
    processed[itemId] = {
      processedAt: new Date().toISOString(),
      ...metadata,
    };
    saveState();
  }

  /**
   * Poll a source and return only new (unprocessed) items
   */
  async function pollNew(sourceType, options = {}) {
    const items = await pollSource(sourceType, options, configPath);
    return items.filter((item) => !isProcessed(item.id));
  }

  /**
   * Clear processed state for testing
   */
  function clearState() {
    processed = {};
    saveState();
  }

  return {
    pollSource: (sourceType, opts) => pollSource(sourceType, opts, configPath),
    pollNew,
    isProcessed,
    markProcessed,
    clearState,
    get processedCount() {
      return Object.keys(processed).length;
    },
  };
}
