/**
 * repo-config.js - Unified repository configuration management
 *
 * Manages per-repository configuration stored in ~/.config/opencode-pilot/repos.yaml
 * Supports exact matches (myorg/backend) and prefix matches (myorg/)
 * Configs are merged with most specific match taking precedence
 */

import fs from "fs";
import path from "path";
import os from "os";
import YAML from "yaml";

// Default config path
const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config/opencode-pilot/repos.yaml"
);

// In-memory config cache (for testing and runtime)
let configCache = null;

/**
 * Default global configuration
 */
const DEFAULT_GLOBAL_CONFIG = {};

/**
 * Default source configuration (applied when no sources specified)
 */
const DEFAULT_SOURCE = {
  type: "github_issue",
  fetch: {
    assignee: "@me",
    state: "open",
  },
};

/**
 * Default repo configuration
 */
const DEFAULT_CONFIG = {
  sources: [],
  readiness: {
    labels: {
      required: [],
      any_of: [],
      exclude: [],
    },
    priority: {
      labels: [],
      age_weight: 1,
    },
    dependencies: {
      check_body_references: true,
      blocking_labels: ["blocked"],
    },
  },
};

/**
 * Deep merge two objects
 * Arrays named 'sources' are concatenated, other arrays are replaced
 */
function deepMerge(base, overlay) {
  if (!overlay) return base;
  if (!base) return overlay;

  if (typeof base !== "object" || typeof overlay !== "object") {
    return overlay;
  }

  if (Array.isArray(base) || Array.isArray(overlay)) {
    return overlay;
  }

  const result = { ...base };

  for (const key of Object.keys(overlay)) {
    if (key === "sources") {
      // Concatenate sources arrays
      result[key] = [...(base[key] || []), ...(overlay[key] || [])];
    } else if (
      typeof base[key] === "object" &&
      typeof overlay[key] === "object" &&
      !Array.isArray(base[key]) &&
      !Array.isArray(overlay[key])
    ) {
      // Recursively merge objects
      result[key] = deepMerge(base[key], overlay[key]);
    } else if (overlay[key] !== undefined) {
      // Overlay wins for primitives and arrays
      result[key] = overlay[key];
    }
  }

  return result;
}

/**
 * Expand {repo} placeholder in strings
 */
function expandPlaceholders(obj, repoName) {
  if (typeof obj === "string") {
    return obj.replace(/\{repo\}/g, repoName);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandPlaceholders(item, repoName));
  }
  if (typeof obj === "object" && obj !== null) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandPlaceholders(value, repoName);
    }
    return result;
  }
  return obj;
}

/**
 * Load repo configuration from YAML file or object
 * @param {string|object} [configOrPath] - Path to YAML file or config object
 */
export function loadRepoConfig(configOrPath) {
  if (typeof configOrPath === "object") {
    // Direct config object (for testing)
    configCache = configOrPath;
    return configCache;
  }

  const configPath = configOrPath || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    configCache = { repos: {} };
    return configCache;
  }

  const content = fs.readFileSync(configPath, "utf-8");
  configCache = YAML.parse(content);
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
 * Find matching config keys for a repo (prefix and exact matches)
 * Returns keys sorted by specificity (most specific last)
 */
function findMatchingKeys(repoKey) {
  const config = getRawConfig();
  const repos = config.repos || {};

  const matches = [];

  for (const configKey of Object.keys(repos)) {
    // Exact match
    if (configKey === repoKey) {
      matches.push({ key: configKey, length: configKey.length, exact: true });
    }
    // Prefix match (config key ends with / and repo starts with it)
    else if (configKey.endsWith("/") && repoKey.startsWith(configKey)) {
      matches.push({ key: configKey, length: configKey.length, exact: false });
    }
  }

  // Sort by length (less specific first), exact matches last among same length
  matches.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    if (a.exact !== b.exact) return a.exact ? 1 : -1;
    return 0;
  });

  return matches.map((m) => m.key);
}

/**
 * Get configuration for a specific repo with prefix matching and merging
 * @param {string} repoKey - Repository identifier (e.g., "myorg/backend")
 * @returns {object} Merged configuration with defaults
 */
export function getRepoConfig(repoKey) {
  const config = getRawConfig();
  const repos = config.repos || {};

  // Start with defaults
  let merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Find all matching keys (sorted by specificity)
  const matchingKeys = findMatchingKeys(repoKey);

  // Extract repo name for placeholder expansion
  const repoName = repoKey.split("/").pop();

  // Apply each matching config in order
  for (const configKey of matchingKeys) {
    let repoConfig = repos[configKey];
    if (repoConfig) {
      // Expand placeholders
      repoConfig = expandPlaceholders(repoConfig, repoName);
      // Deep merge
      merged = deepMerge(merged, repoConfig);
    }
  }

  // Apply default source if no sources specified
  if (!merged.sources || merged.sources.length === 0) {
    merged.sources = [JSON.parse(JSON.stringify(DEFAULT_SOURCE))];
  }

  return merged;
}

/**
 * Get all sources across all repos (for polling)
 * @returns {Array} Array of {repo_key, repo_path, ...source} objects
 */
export function getAllSources() {
  const config = getRawConfig();
  const repos = config.repos || {};

  const sources = [];

  // Only process non-prefix repos (exact matches)
  for (const repoKey of Object.keys(repos)) {
    if (repoKey.endsWith("/")) continue; // Skip prefixes

    const repoConfig = getRepoConfig(repoKey);
    const repoPath = repoConfig.repo_path || "";

    for (const source of repoConfig.sources || []) {
      sources.push({
        repo_key: repoKey,
        repo_path: repoPath,
        ...source,
      });
    }
  }

  return sources;
}

/**
 * List all configured repo keys
 * @param {object} [options] - Options
 * @param {boolean} [options.includePrefix] - Include prefix keys (default: true)
 * @returns {Array<string>} List of repo keys
 */
export function listRepos(options = {}) {
  const config = getRawConfig();
  const repos = config.repos || {};
  const includePrefix = options.includePrefix !== false;

  const keys = Object.keys(repos);
  if (includePrefix) {
    return keys;
  }
  return keys.filter((k) => !k.endsWith("/"));
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
    if (repoKey.endsWith("/")) continue; // Skip prefixes

    const repoConfig = getRepoConfig(repoKey);
    if (!repoConfig.repo_path) continue;

    const repoPath = path.resolve(
      repoConfig.repo_path.replace(/^~/, os.homedir())
    );
    if (normalizedSearch === repoPath) {
      return repoKey;
    }
  }

  return null;
}

/**
 * Get global configuration (top-level settings outside repos)
 * @returns {object} Global config with defaults
 */
export function getGlobalConfig() {
  const config = getRawConfig();
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...config.global,
  };
}

/**
 * Clear config cache (for testing)
 */
export function clearConfigCache() {
  configCache = null;
}
