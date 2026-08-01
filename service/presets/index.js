/**
 * presets/index.js - Built-in source presets for common patterns
 *
 * Presets reduce config verbosity by providing sensible defaults
 * for common polling sources like GitHub issues and Linear tickets.
 * 
 * Presets are loaded from YAML files in this directory.
 * Each file can include a _provider key with provider-level config
 * (response_key, mappings) that applies to all presets for that provider.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache for loaded provider data
const providerCache = {};

/**
 * Load provider data from a YAML file
 * @param {string} provider - Provider name (e.g., "github", "linear")
 * @returns {object} Provider data with presets and _provider config
 */
function loadProviderData(provider) {
  if (providerCache[provider]) {
    return providerCache[provider];
  }

  const filePath = path.join(__dirname, `${provider}.yaml`);
  if (!fs.existsSync(filePath)) {
    providerCache[provider] = { presets: {}, providerConfig: null };
    return providerCache[provider];
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = YAML.parse(content) || {};
    
    // Extract _provider config and presets
    const { _provider, ...presets } = data;
    
    providerCache[provider] = {
      presets,
      providerConfig: _provider || null,
    };
    return providerCache[provider];
  } catch (err) {
    console.error(`Warning: Failed to load presets from ${filePath}: ${err.message}`);
    providerCache[provider] = { presets: {}, providerConfig: null };
    return providerCache[provider];
  }
}

/**
 * Build the full presets registry from YAML files
 * Format: "provider/preset-name" -> preset config
 */
function buildPresetsRegistry() {
  const registry = {};
  const providers = ["github", "linear", "jira"];
  
  for (const provider of providers) {
    const { presets } = loadProviderData(provider);
    for (const [name, config] of Object.entries(presets)) {
      registry[`${provider}/${name}`] = config;
    }
  }
  
  return registry;
}

// Load presets once at module initialization
const PRESETS = buildPresetsRegistry();

/**
 * Get a preset by name
 * @param {string} presetName - Preset identifier (e.g., "github/my-issues")
 * @returns {object|null} Preset configuration or null if not found
 */
export function getPreset(presetName) {
  return PRESETS[presetName] || null;
}

/**
 * Get provider config (response_key, mappings) for a provider
 * @param {string} provider - Provider name (e.g., "github", "linear")
 * @returns {object|null} Provider config or null if not found
 */
export function getProviderConfig(provider) {
  const { providerConfig } = loadProviderData(provider);
  return providerConfig;
}

/**
 * List all available preset names
 * @returns {string[]} Array of preset names
 */
export function listPresets() {
  return Object.keys(PRESETS);
}

/**
 * Expand a preset into a full source configuration
 * User config is merged on top of preset defaults
 * @param {string} presetName - Preset identifier
 * @param {object} userConfig - User's source config (overrides preset)
 * @returns {object} Merged source configuration
 * @throws {Error} If preset is unknown
 */
export function expandPreset(presetName, userConfig) {
  const preset = getPreset(presetName);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  // Deep merge: preset as base, user config on top
  return {
    ...preset,
    ...userConfig,
    // Merge nested objects specially
    tool: userConfig.tool || preset.tool,
    args: {
      ...preset.args,
      ...(userConfig.args || {}),
    },
    item: userConfig.item || preset.item,
    // Remove the preset key from final output
    preset: undefined,
  };
}

/**
 * Expand GitHub shorthand syntax into full source config
 * @param {string} query - GitHub search query
 * @param {object} userConfig - Rest of user's source config
 * @returns {object} Full source configuration
 */
export function expandGitHubShorthand(query, userConfig) {
  return {
    ...userConfig,
    tool: {
      mcp: "github",
      name: "search_issues",
    },
    args: {
      q: query,
    },
    item: {
      id: "{html_url}",
    },
    // Remove the github key from final output
    github: undefined,
  };
}
