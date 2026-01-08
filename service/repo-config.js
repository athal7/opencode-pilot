/**
 * repo-config.js - Configuration management
 *
 * Manages configuration stored in ~/.config/opencode-pilot/config.yaml
 * Supports:
 * - defaults: default values applied to all sources
 * - repos: per-repository settings (use YAML anchors for sharing)
 * - sources: polling sources with generic tool references, presets, or shorthand
 * - tools: field mappings for normalizing MCP responses
 * - templates: prompt templates stored as markdown files
 */

import fs from "fs";
import path from "path";
import os from "os";
import YAML from "yaml";
import { getNestedValue } from "./utils.js";
import { expandPreset, expandGitHubShorthand, getProviderConfig } from "./presets/index.js";

// Default config path
const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config/opencode/pilot/config.yaml"
);

// Default templates directory
const DEFAULT_TEMPLATES_DIR = path.join(
  os.homedir(),
  ".config/opencode/pilot/templates"
);

// In-memory config cache (for testing and runtime)
let configCache = null;

/**
 * Expand template string with item fields
 * Supports {field} and {field.nested} syntax
 */
function expandTemplate(template, item) {
  return template.replace(/\{([^}]+)\}/g, (match, fieldPath) => {
    const value = getNestedValue(item, fieldPath);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Load configuration from YAML file or object
 * @param {string|object} [configOrPath] - Path to YAML file or config object
 */
export function loadRepoConfig(configOrPath) {
  const emptyConfig = { repos: {}, sources: [] };

  if (typeof configOrPath === "object") {
    // Direct config object (for testing)
    configCache = configOrPath;
    return configCache;
  }

  const configPath = configOrPath || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    configCache = emptyConfig;
    return configCache;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    configCache = YAML.parse(content, { merge: true }) || emptyConfig;
  } catch (err) {
    // Log error but continue with empty config to allow graceful degradation
    console.error(`Warning: Failed to parse config at ${configPath}: ${err.message}`);
    configCache = emptyConfig;
  }
  return configCache;
}

/**
 * Get raw config (loads if not cached)
 */
function getRawConfig() {
  if (!configCache) {
    loadRepoConfig();
  }
  return configCache;
}

/**
 * Get configuration for a specific repo
 * @param {string} repoKey - Repository identifier (e.g., "myorg/backend")
 * @returns {object} Repository configuration or empty object
 */
export function getRepoConfig(repoKey) {
  const config = getRawConfig();
  const repos = config.repos || {};
  const repoConfig = repos[repoKey] || {};

  // Normalize: support both 'path' and 'repo_path' keys
  if (repoConfig.path && !repoConfig.repo_path) {
    return { ...repoConfig, repo_path: repoConfig.path };
  }

  return repoConfig;
}

/**
 * Normalize a single source config
 * Expands presets, shorthand syntax, and applies defaults
 * @param {object} source - Raw source config
 * @param {object} defaults - Default values to apply
 * @returns {object} Normalized source config
 */
function normalizeSource(source, defaults) {
  let normalized = { ...source };

  // Expand preset if present
  if (source.preset) {
    normalized = expandPreset(source.preset, source);
  }

  // Expand GitHub shorthand if present
  if (source.github) {
    normalized = expandGitHubShorthand(source.github, source);
  }

  // Apply defaults (source values take precedence)
  return {
    ...defaults,
    ...normalized,
  };
}

/**
 * Get all top-level sources (for polling)
 * Expands presets and shorthand syntax, applies defaults
 * @returns {Array} Array of normalized source configurations
 */
export function getSources() {
  const config = getRawConfig();
  const rawSources = config.sources || [];
  const defaults = config.defaults || {};

  return rawSources.map((source) => normalizeSource(source, defaults));
}

/**
 * Get defaults section from config
 * @returns {object} Defaults configuration or empty object
 */
export function getDefaults() {
  const config = getRawConfig();
  return config.defaults || {};
}

/**
 * Get all sources (alias for getSources)
 * @returns {Array} Array of source configurations
 */
export function getAllSources() {
  return getSources();
}

/**
 * Get field mappings for a tool provider
 * @param {string} provider - Tool provider name (e.g., "github", "linear")
 * @returns {object|null} Field mappings or null if not configured
 */
export function getToolMappings(provider) {
  const config = getRawConfig();
  const tools = config.tools || {};
  const toolConfig = tools[provider];

  if (!toolConfig || !toolConfig.mappings) {
    return null;
  }

  return toolConfig.mappings;
}

/**
 * Get full tool provider configuration (response_key, mappings, etc.)
 * Checks user config first, then falls back to preset provider defaults
 * @param {string} provider - Tool provider name (e.g., "github", "linear", "apple-reminders")
 * @returns {object|null} Tool config including response_key and mappings, or null if not configured
 */
export function getToolProviderConfig(provider) {
  const config = getRawConfig();
  const tools = config.tools || {};
  const userToolConfig = tools[provider];
  
  // Get preset provider config as fallback
  const presetProviderConfig = getProviderConfig(provider);

  // If user has config, merge with preset defaults (user takes precedence)
  if (userToolConfig) {
    if (presetProviderConfig) {
      return {
        ...presetProviderConfig,
        ...userToolConfig,
        // Deep merge mappings
        mappings: {
          ...(presetProviderConfig.mappings || {}),
          ...(userToolConfig.mappings || {}),
        },
      };
    }
    return userToolConfig;
  }

  // Fall back to preset provider config
  return presetProviderConfig;
}

/**
 * Load a template from the templates directory
 * @param {string} templateName - Template name (without .md extension)
 * @param {string} [templatesDir] - Templates directory path (for testing)
 * @returns {string|null} Template content or null if not found
 */
export function getTemplate(templateName, templatesDir) {
  const dir = templatesDir || DEFAULT_TEMPLATES_DIR;
  const templatePath = path.join(dir, `${templateName}.md`);

  if (!fs.existsSync(templatePath)) {
    return null;
  }

  return fs.readFileSync(templatePath, "utf-8");
}

/**
 * Resolve repos for an item based on source configuration
 * @param {object} source - Source configuration
 * @param {object} item - Item from the source
 * @returns {Array<string>} Array of repo keys
 */
export function resolveRepoForItem(source, item) {
  // Resolve repo from item using template (e.g., "{repository.full_name}")
  let resolvedRepo = null;
  if (typeof source.repo === "string") {
    const resolved = expandTemplate(source.repo, item);
    // Only use if actually resolved (not still a template)
    if (resolved && !resolved.includes("{")) {
      resolvedRepo = resolved;
    }
  }

  // If source.repos is an array, use it as an allowlist filter
  if (Array.isArray(source.repos)) {
    // If we resolved a repo from the item, check if it's in the allowlist
    if (resolvedRepo) {
      return source.repos.includes(resolvedRepo) ? [resolvedRepo] : [];
    }
    // No repo template - return empty (can't match without item context)
    return [];
  }

  // No allowlist - return the resolved repo if we have one
  if (resolvedRepo) {
    return [resolvedRepo];
  }

  // No repo configuration - repo-agnostic source
  return [];
}

/**
 * List all configured repo keys
 * @returns {Array<string>} List of repo keys
 */
export function listRepos() {
  const config = getRawConfig();
  const repos = config.repos || {};
  return Object.keys(repos);
}

/**
 * Find repo key by local filesystem path
 * @param {string} searchPath - Local path to search for
 * @returns {string|null} Repo key or null if not found
 */
export function findRepoByPath(searchPath) {
  const config = getRawConfig();
  const repos = config.repos || {};

  // Normalize search path
  const normalizedSearch = path.resolve(searchPath.replace(/^~/, os.homedir()));

  for (const repoKey of Object.keys(repos)) {
    const repoConfig = repos[repoKey];
    const repoPath = repoConfig.repo_path || repoConfig.path;
    if (!repoPath) continue;

    const normalizedRepoPath = path.resolve(
      repoPath.replace(/^~/, os.homedir())
    );
    if (normalizedSearch === normalizedRepoPath) {
      return repoKey;
    }
  }

  return null;
}

/**
 * Get cleanup TTL days from config
 * @returns {number} TTL in days (default: 30)
 */
export function getCleanupTtlDays() {
  const config = getRawConfig();
  return config?.cleanup?.ttl_days ?? 30;
}

/**
 * Get preferred OpenCode server port from config
 * @returns {number|null} Port number or null if not configured
 */
export function getServerPort() {
  const config = getRawConfig();
  return config?.server_port ?? null;
}

/**
 * Clear config cache (for testing)
 */
export function clearConfigCache() {
  configCache = null;
}
