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
import { getNestedValue, hasNonBotFeedback, extractIssueRefs } from "./utils.js";

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
 * Supports both MCP tools and CLI commands.
 * 
 * @param {object} source - Source configuration from config.yaml
 * @returns {object} Tool configuration with type indicator
 */
export function getToolConfig(source) {
  if (!source.tool) {
    throw new Error(`Source '${source.name || 'unknown'}' missing tool configuration`);
  }

  // CLI command support
  if (source.tool.command) {
    return {
      type: 'cli',
      command: source.tool.command,
      args: source.args || {},
      idTemplate: source.item?.id || null,
    };
  }

  // MCP tool support (existing behavior)
  if (!source.tool.mcp || !source.tool.name) {
    throw new Error(`Source '${source.name || 'unknown'}' missing tool configuration (requires tool.mcp and tool.name, or tool.command)`);
  }

  return {
    type: 'mcp',
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
 * Execute a CLI command and return parsed JSON output
 * 
 * @param {string|string[]} command - Command to execute (string or array)
 * @param {object} args - Arguments to substitute into command
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<string>} Command output
 */
async function executeCliCommand(command, args, timeout) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Build command string
  let cmdStr;
  if (Array.isArray(command)) {
    // Substitute args into command array
    const expandedCmd = command.map(part => {
      if (typeof part === 'string' && part.startsWith('$')) {
        const argName = part.slice(1);
        return args[argName] !== undefined ? String(args[argName]) : part;
      }
      return part;
    });
    // Quote parts with spaces or shell special characters
    const shellSpecialChars = /[ <>|&;$`"'\\!*?#~=\[\]{}()]/;
    cmdStr = expandedCmd.map(p => shellSpecialChars.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p).join(' ');
  } else {
    // String command - substitute ${argName} patterns
    cmdStr = command.replace(/\$\{(\w+)\}/g, (_, name) => {
      return args[name] !== undefined ? String(args[name]) : '';
    });
  }

  const { stdout } = await Promise.race([
    execAsync(cmdStr, { env: { ...process.env } }),
    createTimeout(timeout, `CLI command: ${cmdStr.slice(0, 50)}...`),
  ]);

  return stdout;
}

/**
 * Poll a source using CLI command
 * 
 * @param {object} source - Source configuration from config.yaml
 * @param {object} toolConfig - Tool config from getToolConfig()
 * @param {object} [options] - Additional options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @param {object} [options.toolProviderConfig] - Tool provider config (response_key, mappings)
 * @returns {Promise<Array>} Array of items from the source with IDs and mappings applied
 */
async function pollCliSource(source, toolConfig, options = {}) {
  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  const toolProviderConfig = options.toolProviderConfig || {};
  const responseKey = toolProviderConfig.response_key;
  const mappings = toolProviderConfig.mappings || null;

  try {
    const output = await executeCliCommand(toolConfig.command, toolConfig.args, timeout);
    
    if (!output || !output.trim()) return [];

    const rawItems = parseJsonArray(output, source.name, responseKey);

    // Apply field mappings before transforming
    const mappedItems = mappings
      ? rawItems.map(item => applyMappings(item, mappings))
      : rawItems;

    // Transform items (add IDs)
    return transformItems(mappedItems, toolConfig.idTemplate);
  } catch (err) {
    console.error(`[poller] CLI command failed for ${source.name}: ${err.message}`);
    return [];
  }
}

/**
 * Poll a source using MCP tools or CLI commands
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

  // Route to CLI handler if command-based
  if (toolConfig.type === 'cli') {
    return pollCliSource(source, toolConfig, options);
  }

  // MCP-based polling (existing behavior)
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
 * Fetch issue comments using gh CLI
 * 
 * Fetches the conversation thread where bots like Linear post their comments.
 * 
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - Issue/PR number
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Array>} Array of comment objects
 */
async function fetchIssueCommentsViaCli(owner, repo, number, timeout) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await Promise.race([
      execAsync(`gh api repos/${owner}/${repo}/issues/${number}/comments`),
      createTimeout(timeout, "gh api call"),
    ]);
    
    const comments = JSON.parse(stdout);
    return Array.isArray(comments) ? comments : [];
  } catch (err) {
    // gh CLI might not be available or authenticated
    console.error(`[poller] Error fetching issue comments via gh: ${err.message}`);
    return [];
  }
}

/**
 * Fetch PR review comments using gh CLI
 * 
 * Fetches inline code review comments on a PR.
 * 
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - PR number
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Array>} Array of comment objects
 */
async function fetchPrReviewCommentsViaCli(owner, repo, number, timeout) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await Promise.race([
      execAsync(`gh api repos/${owner}/${repo}/pulls/${number}/comments`),
      createTimeout(timeout, "gh api call for PR comments"),
    ]);
    
    const comments = JSON.parse(stdout);
    return Array.isArray(comments) ? comments : [];
  } catch (err) {
    console.error(`[poller] Error fetching PR review comments via gh: ${err.message}`);
    return [];
  }
}

/**
 * Fetch PR reviews using gh CLI
 * 
 * Fetches formal PR reviews (APPROVED, CHANGES_REQUESTED, COMMENTED state).
 * These are separate from inline comments and issue comments.
 * 
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - PR number
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Array>} Array of review objects with user, state, body
 */
async function fetchPrReviewsViaCli(owner, repo, number, timeout) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await Promise.race([
      execAsync(`gh api repos/${owner}/${repo}/pulls/${number}/reviews`),
      createTimeout(timeout, "gh api call for PR reviews"),
    ]);
    
    const reviews = JSON.parse(stdout);
    return Array.isArray(reviews) ? reviews : [];
  } catch (err) {
    console.error(`[poller] Error fetching PR reviews via gh: ${err.message}`);
    return [];
  }
}

/**
 * Fetch comments for a GitHub issue/PR and enrich the item
 * 
 * Fetches THREE types of feedback using gh CLI:
 * 1. PR review comments (inline code comments) via gh api pulls/{number}/comments
 * 2. Issue comments (conversation thread) via gh api issues/{number}/comments
 * 3. PR reviews (formal reviews) via gh api pulls/{number}/reviews
 * 
 * This is necessary because:
 * - Bots like Linear post to issue comments, not PR review comments
 * - Human reviewers post inline feedback as PR review comments
 * - Formal PR reviews (APPROVED, CHANGES_REQUESTED, COMMENTED) are stored separately
 * 
 * @param {object} item - Item with repository_full_name and number fields
 * @param {object} [options] - Options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @returns {Promise<Array>} Array of comment/review objects (merged from all endpoints)
 */
export async function fetchGitHubComments(item, options = {}) {
  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  
  // Extract owner and repo from item
  // The item should have repository_full_name (e.g., "owner/repo") from mapping
  const fullName = item.repository_full_name;
  if (!fullName) {
    console.error("[poller] Cannot fetch comments: missing repository_full_name");
    return [];
  }
  
  const [owner, repo] = fullName.split("/");
  const number = item.number;
  
  if (!owner || !repo || !number) {
    console.error("[poller] Cannot fetch comments: missing owner, repo, or number");
    return [];
  }
  
  try {
    // Fetch PR review comments, issue comments, AND PR reviews in parallel via gh CLI
    const [prComments, issueComments, prReviews] = await Promise.all([
      // PR review comments (inline code comments from reviewers)
      fetchPrReviewCommentsViaCli(owner, repo, number, timeout),
      // Issue comments (conversation thread where Linear bot posts)
      fetchIssueCommentsViaCli(owner, repo, number, timeout),
      // PR reviews (formal reviews: APPROVED, CHANGES_REQUESTED, COMMENTED)
      fetchPrReviewsViaCli(owner, repo, number, timeout),
    ]);
    
    // Return merged feedback from all sources
    return [...prComments, ...issueComments, ...prReviews];
  } catch (err) {
    console.error(`[poller] Error fetching comments: ${err.message}`);
    return [];
  }
}

/**
 * Check if a source is a GitHub source (MCP or CLI-based)
 * @param {object} source - Source configuration
 * @returns {boolean} True if this is a GitHub source
 */
function isGitHubSource(source) {
  // MCP-based GitHub source
  if (source.tool?.mcp === "github") return true;
  
  // CLI-based GitHub source (uses gh command)
  const command = source.tool?.command;
  if (Array.isArray(command) && command[0] === "gh") return true;
  
  return false;
}

/**
 * Enrich items with comments for bot filtering
 * 
 * For items from sources with filter_bot_comments: true, fetches comments
 * and attaches them as _comments field for readiness evaluation.
 * 
 * @param {Array} items - Items to enrich
 * @param {object} source - Source configuration with optional filter_bot_comments
 * @param {object} [options] - Options passed to fetchGitHubComments
 * @returns {Promise<Array>} Items with _comments field added
 */
export async function enrichItemsWithComments(items, source, options = {}) {
  // Skip if not configured or not a GitHub source
  if (!source.filter_bot_comments || !isGitHubSource(source)) {
    return items;
  }
  
  // Fetch comments for each item (could be parallelized with Promise.all for speed)
  // Note: Always fetch reviews - commentsCount from gh search only counts issue comments,
  // not PR reviews or PR review comments. PRs with only review feedback would be missed.
  const enrichedItems = [];
  for (const item of items) {
    const comments = await fetchGitHubComments(item, options);
    enrichedItems.push({ ...item, _comments: comments });
  }
  
  return enrichedItems;
}

/**
 * Fetch mergeable status for a PR via gh CLI
 * 
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - PR number
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<string|null>} Mergeable status ("MERGEABLE", "CONFLICTING", "UNKNOWN") or null on error
 */
async function fetchMergeableStatus(owner, repo, number, timeout) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await Promise.race([
      execAsync(`gh pr view ${number} -R ${owner}/${repo} --json mergeable --jq .mergeable`),
      createTimeout(timeout, "gh pr view"),
    ]);
    
    const status = stdout.trim();
    return status || null;
  } catch (err) {
    console.error(`[poller] Error fetching mergeable status for ${owner}/${repo}#${number}: ${err.message}`);
    return null;
  }
}

/**
 * Enrich items with mergeable status for conflict detection
 * 
 * For items from sources with enrich_mergeable: true, fetches mergeable status
 * via gh CLI and attaches it as _mergeable field for readiness evaluation.
 * 
 * @param {Array} items - Items to enrich
 * @param {object} source - Source configuration with optional enrich_mergeable
 * @param {object} [options] - Options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @returns {Promise<Array>} Items with _mergeable field added
 */
export async function enrichItemsWithMergeable(items, source, options = {}) {
  // Skip if not configured
  if (!source.enrich_mergeable) {
    return items;
  }
  
  const timeout = options.timeout || DEFAULT_MCP_TIMEOUT;
  
  // Fetch mergeable status for each item
  const enrichedItems = [];
  for (const item of items) {
    // Extract owner/repo from item
    const fullName = item.repository_full_name || item.repository?.nameWithOwner;
    if (!fullName || !item.number) {
      enrichedItems.push(item);
      continue;
    }
    
    const [owner, repo] = fullName.split("/");
    const mergeable = await fetchMergeableStatus(owner, repo, item.number, timeout);
    enrichedItems.push({ ...item, _mergeable: mergeable });
  }
  
  return enrichedItems;
}

/**
 * Compute attention label from enriched item conditions
 * 
 * Examines _mergeable and _comments fields to determine what needs attention.
 * Sets _attention_label (for session name) and _has_attention (for readiness).
 * 
 * @param {Array} items - Items enriched with _mergeable and/or _comments
 * @param {object} source - Source configuration
 * @returns {Array} Items with _attention_label and _has_attention added
 */
export function computeAttentionLabels(items, source) {
  return items.map(item => {
    const reasons = [];
    
    // Check for merge conflicts
    if (item._mergeable === 'CONFLICTING') {
      reasons.push('Conflicts');
    }
    
    // Check for human feedback using the shared hasNonBotFeedback utility
    // This properly handles known bots like 'linear' that don't have [bot] suffix
    if (item._comments && item._comments.length > 0) {
      const authorUsername = item.user?.login || item.author?.login;
      if (hasNonBotFeedback(item._comments, authorUsername)) {
        reasons.push('Feedback');
      }
    }
    
    // Build label: "Conflicts", "Feedback", or "Conflicts+Feedback"
    const label = reasons.length > 0 ? reasons.join('+') : 'PR';
    
    return {
      ...item,
      _attention_label: label,
      _has_attention: reasons.length > 0,
    };
  });
}

/**
 * Compute deduplication keys for an item
 * 
 * Dedup keys allow cross-source deduplication: when an issue and its linked PR
 * both trigger, we can detect they represent the same work.
 * 
 * Generates keys from:
 * 1. The item's own canonical identifier (Linear ID, GitHub repo#number)
 * 2. Issue references found in title/body (e.g., PR mentioning "Fixes ENG-123")
 * 
 * @param {object} item - Item from a source
 * @param {object} [context] - Context for resolving references
 * @param {string} [context.repo] - Repository (e.g., "org/repo") for GitHub relative refs
 * @returns {string[]} Array of dedup keys (e.g., ["linear:ENG-123", "github:org/repo#456"])
 */
export function computeDedupKeys(item, context = {}) {
  const keys = new Set();
  
  // 1. Generate canonical key for the item itself
  
  // Linear items: use the "number" field which is the issue identifier (e.g., "ENG-123")
  // Linear preset maps this from url using regex: "url:/([A-Z0-9]+-[0-9]+)/"
  if (item.number && typeof item.number === 'string' && /^[A-Z][A-Z0-9]*-\d+$/.test(item.number)) {
    keys.add(`linear:${item.number}`);
  }
  
  // GitHub items: use repo + number
  // GitHub items have repository.nameWithOwner or repository_full_name (after mapping)
  const repo = item.repository_full_name || item.repository?.nameWithOwner || context.repo;
  if (repo && item.number && typeof item.number === 'number') {
    keys.add(`github:${repo}#${item.number}`);
  }
  
  // 2. Extract issue references from title and body
  const textToSearch = [item.title, item.body].filter(Boolean).join('\n');
  const issueRefs = extractIssueRefs(textToSearch, { repo });
  for (const ref of issueRefs) {
    keys.add(ref);
  }
  
  return Array.from(keys);
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
  const stateFile = options.stateFile || path.join(os.homedir(), '.config/opencode/pilot/poll-state.json');
  const configPath = options.configPath;
  
  // Load existing state
  let processedItems = new Map();
  // Dedup key index: maps dedup keys to item IDs for cross-source deduplication
  let dedupKeyIndex = new Map();
  
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (state.processed) {
        processedItems = new Map(Object.entries(state.processed));
      }
      if (state.dedupKeys) {
        dedupKeyIndex = new Map(Object.entries(state.dedupKeys));
      }
    } catch {
      // Start fresh if state is corrupted
    }
  }
  
  // Rebuild dedup key index from processed items if not in state file
  // (handles migration from older state files)
  if (dedupKeyIndex.size === 0 && processedItems.size > 0) {
    for (const [itemId, meta] of processedItems) {
      if (meta.dedupKeys && Array.isArray(meta.dedupKeys)) {
        for (const key of meta.dedupKeys) {
          dedupKeyIndex.set(key, itemId);
        }
      }
    }
  }
  
  function saveState() {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const state = {
      processed: Object.fromEntries(processedItems),
      dedupKeys: Object.fromEntries(dedupKeyIndex),
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
     * Check if any of the given dedup keys have been processed
     * Used for cross-source deduplication (e.g., Linear issue + GitHub PR)
     * @param {string[]} dedupKeys - Array of dedup keys to check
     * @returns {string|null} The item ID that owns a matching dedup key, or null
     */
    findProcessedByDedupKey(dedupKeys) {
      for (const key of dedupKeys) {
        const itemId = dedupKeyIndex.get(key);
        if (itemId && processedItems.has(itemId)) {
          return itemId;
        }
      }
      return null;
    },
    
    /**
     * Get metadata for a processed item
     * @param {string} itemId - Item ID
     * @returns {object|null} Metadata or null if not processed
     */
    getProcessedMeta(itemId) {
      return processedItems.get(itemId) || null;
    },
    
    /**
     * Mark an item as processed
     * @param {string} itemId - Item ID
     * @param {object} [metadata] - Additional metadata to store
     * @param {string[]} [metadata.dedupKeys] - Dedup keys for cross-source deduplication
     */
    markProcessed(itemId, metadata = {}) {
      // Store dedup keys in item metadata
      const itemMeta = {
        processedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        ...metadata,
      };
      processedItems.set(itemId, itemMeta);
      
      // Index dedup keys for fast lookup
      if (metadata.dedupKeys && Array.isArray(metadata.dedupKeys)) {
        for (const key of metadata.dedupKeys) {
          dedupKeyIndex.set(key, itemId);
        }
      }
      
      saveState();
    },
    
    /**
     * Update lastSeenAt for items currently in poll results
     * Call this after each poll to track which items are still present
     * @param {string[]} itemIds - IDs of items in current poll results
     */
    markSeen(itemIds) {
      const now = new Date().toISOString();
      let changed = false;
      for (const id of itemIds) {
        const meta = processedItems.get(id);
        if (meta) {
          meta.lastSeenAt = now;
          changed = true;
        }
      }
      if (changed) saveState();
    },
    
    /**
     * Check if an item has reappeared after being missing from poll results
     * @param {string} itemId - Item ID
     * @returns {boolean} True if item was missing and has now reappeared
     */
    hasReappeared(itemId) {
      const meta = processedItems.get(itemId);
      if (!meta) return false;
      if (!meta.lastSeenAt) return false;
      
      // If lastSeenAt is older than processedAt, the item disappeared and reappeared
      // (lastSeenAt wasn't updated because item wasn't in poll results)
      const lastSeen = new Date(meta.lastSeenAt).getTime();
      const processed = new Date(meta.processedAt).getTime();
      
      // Item reappeared if it was last seen at processing time but not since
      // We check if there's a gap of at least one poll interval (assume 5 min)
      // Actually, simpler: if lastSeenAt equals processedAt after multiple polls,
      // the item was missing. But we need to track poll cycles...
      
      // Simpler approach: track wasSeenInLastPoll flag
      return meta.wasUnseen === true;
    },
    
    /**
     * Mark items that were NOT in poll results as unseen
     * @param {string} sourceName - Source name
     * @param {string[]} currentItemIds - IDs of items in current poll results
     */
    markUnseen(sourceName, currentItemIds) {
      const currentSet = new Set(currentItemIds);
      let changed = false;
      for (const [id, meta] of processedItems) {
        if (meta.source === sourceName) {
          if (currentSet.has(id)) {
            // Item is present - clear unseen flag, update lastSeenAt
            if (meta.wasUnseen) {
              meta.wasUnseen = false;
              changed = true;
            }
            meta.lastSeenAt = new Date().toISOString();
            changed = true;
          } else {
            // Item is missing - mark as unseen
            if (!meta.wasUnseen) {
              meta.wasUnseen = true;
              changed = true;
            }
          }
        }
      }
      if (changed) saveState();
    },
    
    /**
     * Clear a specific item from processed state
     * Also removes its dedup keys from the index
     */
    clearProcessed(itemId) {
      // Remove dedup keys from index first
      const meta = processedItems.get(itemId);
      if (meta && meta.dedupKeys && Array.isArray(meta.dedupKeys)) {
        for (const key of meta.dedupKeys) {
          dedupKeyIndex.delete(key);
        }
      }
      processedItems.delete(itemId);
      saveState();
    },
    
    /**
     * Clear all processed state
     */
    clearState() {
      processedItems.clear();
      dedupKeyIndex.clear();
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
     * Also removes associated dedup keys from the index
     * @param {string} sourceName - Source name
     * @returns {number} Number of entries removed
     */
    clearBySource(sourceName) {
      let removed = 0;
      for (const [id, meta] of processedItems) {
        if (meta.source === sourceName) {
          // Remove dedup keys from index
          if (meta.dedupKeys && Array.isArray(meta.dedupKeys)) {
            for (const key of meta.dedupKeys) {
              dedupKeyIndex.delete(key);
            }
          }
          processedItems.delete(id);
          removed++;
        }
      }
      if (removed > 0) saveState();
      return removed;
    },
    
    /**
     * Remove entries older than ttlDays
     * Also removes associated dedup keys from the index
     * @param {number} [ttlDays=30] - Days before expiration
     * @returns {number} Number of entries removed
     */
    cleanupExpired(ttlDays = 30) {
      const cutoffMs = Date.now() - (ttlDays * 24 * 60 * 60 * 1000);
      let removed = 0;
      for (const [id, meta] of processedItems) {
        const processedAt = new Date(meta.processedAt).getTime();
        if (processedAt < cutoffMs) {
          // Remove dedup keys from index
          if (meta.dedupKeys && Array.isArray(meta.dedupKeys)) {
            for (const key of meta.dedupKeys) {
              dedupKeyIndex.delete(key);
            }
          }
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
     * Also removes associated dedup keys from the index
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
            // Remove dedup keys from index
            if (meta.dedupKeys && Array.isArray(meta.dedupKeys)) {
              for (const key of meta.dedupKeys) {
                dedupKeyIndex.delete(key);
              }
            }
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
     * Uses reprocess_on config to determine which fields to check.
     * Also reprocesses items that reappeared after being missing.
     * 
     * @param {object} item - Current item from source
     * @param {object} [options] - Options
     * @param {string[]} [options.reprocessOn] - Fields to check for changes (e.g., ['state', 'updated_at'])
     * @returns {boolean} True if item should be reprocessed
     */
    shouldReprocess(item, options = {}) {
      if (!item.id) return false;
      
      const meta = processedItems.get(item.id);
      if (!meta) return false; // Not processed before
      
      // Check if item reappeared after being missing (e.g., uncompleted reminder)
      if (meta.wasUnseen) {
        return true;
      }
      
      // Get reprocess_on fields from options, default to state/status only
      // Note: updated_at is NOT included by default because our own changes would trigger reprocessing
      const reprocessOn = options.reprocessOn || ['state', 'status'];
      
      // Check each configured field for changes
      for (const field of reprocessOn) {
        // Handle state/status fields (detect reopening)
        if (field === 'state' || field === 'status') {
          const storedState = meta.itemState;
          const currentState = item[field];
          
          if (storedState && currentState) {
            const stored = storedState.toLowerCase();
            const current = currentState.toLowerCase();
            
            // Reopened: was closed/merged/done, now open/in-progress
            if ((stored === 'closed' || stored === 'merged' || stored === 'done') 
                && (current === 'open' || current === 'in progress')) {
              return true;
            }
          }
        }
        
        // Handle timestamp fields (detect updates)
        if (field === 'updated_at' || field === 'updatedAt') {
          const storedTimestamp = meta.itemUpdatedAt;
          const currentTimestamp = item[field] || item.updated_at || item.updatedAt;
          
          if (storedTimestamp && currentTimestamp) {
            const storedTime = new Date(storedTimestamp).getTime();
            const currentTime = new Date(currentTimestamp).getTime();
            if (currentTime > storedTime) {
              return true;
            }
          }
        }
      }
      
      return false;
    },
  };
}
