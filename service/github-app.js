/**
 * github-app.js - GitHub App authentication
 *
 * Generates installation access tokens for GitHub Apps.
 * Tokens are cached and refreshed when near expiry.
 */

import { createSign } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

// Token cache: { [installationId]: { token, expiresAt } }
const tokenCache = new Map();

// Refresh tokens 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Expand ~ to home directory in paths
 */
function expandPath(p) {
  if (p && p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Create a JWT for GitHub App authentication
 * @param {string} appId - GitHub App ID
 * @param {string} privateKey - PEM-encoded private key
 * @returns {string} JWT token
 */
export function createAppJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago (clock skew)
    exp: now + 10 * 60, // Expires in 10 minutes
    iss: appId,
  };

  const header = { alg: "RS256", typ: "JWT" };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url"
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, "base64url");

  return `${signatureInput}.${signature}`;
}

/**
 * Get installation access token from GitHub API
 * @param {string} jwt - App JWT
 * @param {string} appId - GitHub App ID
 * @param {string} installationId - Installation ID
 * @returns {Promise<{token: string, expiresAt: Date}>}
 */
async function fetchInstallationToken(jwt, appId, installationId) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to get installation token for app ${appId} / installation ${installationId}: ${response.status} ${error}`
    );
  }

  const data = await response.json();
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
}

/**
 * Load private key from file or return inline key
 * @param {object} config - Bot config with private_key or private_key_path
 * @returns {string} PEM-encoded private key
 */
function loadPrivateKey(config) {
  // Inline key takes precedence
  if (config.github_app_private_key) {
    // Handle env var expansion that may have occurred
    let key = config.github_app_private_key;
    // If the key has literal \n, convert to actual newlines
    if (key.includes("\\n")) {
      key = key.replace(/\\n/g, "\n");
    }
    return key;
  }

  // Load from file
  if (config.github_app_private_key_path) {
    const keyPath = expandPath(config.github_app_private_key_path);
    return fs.readFileSync(keyPath, "utf-8");
  }

  throw new Error(
    "GitHub App config requires github_app_private_key or github_app_private_key_path"
  );
}

/**
 * Check if a GitHub App is configured
 * @param {object} botConfig - Bot identity config
 * @returns {boolean}
 */
export function isGitHubAppConfigured(botConfig) {
  if (!botConfig) return false;
  return !!(
    botConfig.github_app_id &&
    botConfig.github_app_installation_id &&
    (botConfig.github_app_private_key || botConfig.github_app_private_key_path)
  );
}

/**
 * Get GitHub App token, using cache if valid
 * @param {object} botConfig - Bot identity config with GitHub App settings
 * @returns {Promise<string>} Installation access token
 */
export async function getGitHubAppToken(botConfig) {
  const installationId = botConfig.github_app_installation_id;
  const appId = botConfig.github_app_id;

  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached) {
    const now = Date.now();
    const expiresAt = cached.expiresAt.getTime();
    if (now < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return cached.token;
    }
  }

  // Generate new token
  const privateKey = loadPrivateKey(botConfig);
  const jwt = createAppJwt(appId, privateKey);
  const { token, expiresAt } = await fetchInstallationToken(jwt, appId, installationId);

  // Cache it
  tokenCache.set(installationId, { token, expiresAt });

  return token;
}

/**
 * Get git identity for a GitHub App
 * @param {object} botConfig - Bot identity config
 * @returns {{name: string, email: string}}
 */
export function getGitHubAppIdentity(botConfig) {
  const appId = botConfig.github_app_id;
  const appSlug = botConfig.github_app_slug || "opencode-pilot";

  return {
    name: `${appSlug}[bot]`,
    email: `${appId}+${appSlug}[bot]@users.noreply.github.com`,
  };
}

/**
 * Clear token cache (for testing)
 */
export function clearTokenCache() {
  tokenCache.clear();
}
