/**
 * Tests for repo-config.js - configuration for repos, sources, tools, templates, and identity
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadRepoConfig,
  getRepoConfig,
  getSources,
  getAllSources,
  getToolMappings,
  getTemplate,
  resolveRepoForItem,
  listRepos,
  findRepoByPath,
  resolveIdentity,
  clearConfigCache,
} from '../../service/repo-config.js';

describe('repo-config.js', () => {
  let tempDir;
  let configPath;
  let templatesDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-test-'));
    configPath = join(tempDir, 'config.yaml');
    templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir);
    clearConfigCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearConfigCache();
    delete process.env.TEST_APP_KEY;
  });

  describe('error handling', () => {
    test('handles malformed YAML gracefully', () => {
      // Write invalid YAML (unbalanced quotes)
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: "~/code/backend
`);

      // Should not throw, should return empty
      loadRepoConfig(configPath);
      const sources = getSources();
      
      assert.deepStrictEqual(sources, []);
    });

    test('handles empty file gracefully', () => {
      writeFileSync(configPath, '');

      loadRepoConfig(configPath);
      const sources = getSources();
      
      assert.deepStrictEqual(sources, []);
    });
  });

  describe('repos', () => {
    test('gets repo config with path', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      loadRepoConfig(configPath);
      const config = getRepoConfig('myorg/backend');

      assert.strictEqual(config.path, '~/code/backend');
      assert.strictEqual(config.repo_path, '~/code/backend');
    });

    test('returns empty object for unknown repo', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      loadRepoConfig(configPath);
      const config = getRepoConfig('unknown/repo');

      assert.deepStrictEqual(config, {});
    });

    test('supports YAML anchors for shared config', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend: &default-repo
    path: ~/code/backend
    prompt: devcontainer
    session:
      name: "issue-{number}"

  myorg/frontend:
    <<: *default-repo
    path: ~/code/frontend
`);

      loadRepoConfig(configPath);
      
      const backend = getRepoConfig('myorg/backend');
      const frontend = getRepoConfig('myorg/frontend');

      // Backend has its values
      assert.strictEqual(backend.path, '~/code/backend');
      assert.strictEqual(backend.prompt, 'devcontainer');
      assert.deepStrictEqual(backend.session, { name: 'issue-{number}' });

      // Frontend inherits from anchor, overrides path
      assert.strictEqual(frontend.path, '~/code/frontend');
      assert.strictEqual(frontend.prompt, 'devcontainer');
      assert.deepStrictEqual(frontend.session, { name: 'issue-{number}' });
    });
  });

  describe('sources', () => {
    test('returns sources array from top-level', () => {
      writeFileSync(configPath, `
sources:
  - name: my-issues
    tool:
      mcp: github
      name: github_search_issues
    args:
      q: "is:issue assignee:@me"
    item:
      id: "github:{repository.full_name}#{number}"
    repo: "{repository.full_name}"
`);

      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'my-issues');
      assert.deepStrictEqual(sources[0].tool, { mcp: 'github', name: 'github_search_issues' });
      assert.strictEqual(sources[0].args.q, 'is:issue assignee:@me');
    });

    test('returns empty array when no sources', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      loadRepoConfig(configPath);
      const sources = getSources();

      assert.deepStrictEqual(sources, []);
    });
  });

  describe('templates', () => {
    test('loads template from templates directory', () => {
      writeFileSync(join(templatesDir, 'default.md'), '{title}\n\n{body}');

      const template = getTemplate('default', templatesDir);

      assert.strictEqual(template, '{title}\n\n{body}');
    });

    test('returns null for missing template', () => {
      const template = getTemplate('nonexistent', templatesDir);

      assert.strictEqual(template, null);
    });
  });

  describe('tools mappings', () => {
    test('returns mappings for a tool provider', () => {
      writeFileSync(configPath, `
tools:
  linear:
    mappings:
      number: identifier
      body: description

sources: []
`);

      loadRepoConfig(configPath);
      
      const mappings = getToolMappings('linear');
      
      assert.deepStrictEqual(mappings, {
        number: 'identifier',
        body: 'description'
      });
    });

    test('returns null for unknown provider', () => {
      writeFileSync(configPath, `
tools:
  github:
    mappings:
      url: html_url

sources: []
`);

      loadRepoConfig(configPath);
      
      const mappings = getToolMappings('unknown');
      
      assert.strictEqual(mappings, null);
    });
  });

  describe('listRepos', () => {
    test('lists all configured repos', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
  myorg/frontend:
    path: ~/code/frontend
`);

      loadRepoConfig(configPath);
      const repos = listRepos();

      assert.deepStrictEqual(repos, ['myorg/backend', 'myorg/frontend']);
    });
  });

  describe('findRepoByPath', () => {
    test('finds repo by path', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      loadRepoConfig(configPath);
      const repoKey = findRepoByPath('~/code/backend');

      assert.strictEqual(repoKey, 'myorg/backend');
    });

    test('returns null for unknown path', () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      loadRepoConfig(configPath);
      const repoKey = findRepoByPath('~/code/unknown');

      assert.strictEqual(repoKey, null);
    });
  });

  describe("resolveIdentity", () => {
    describe("policy resolution", () => {
      test("returns null for user policy", () => {
        loadRepoConfig({
          identity: {
            policy: {
              autonomous: "user",
              interactive: "user",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity, null);
      });

      test("returns null when no policy configured", () => {
        loadRepoConfig({
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity, null);
      });

      test("returns bot identity for bot policy", () => {
        loadRepoConfig({
          identity: {
            bot: {
              github_app_id: "12345",
              github_app_installation_id: "67890",
              github_app_private_key_path: "~/.config/app.pem",
              github_app_slug: "my-bot",
            },
            policy: {
              autonomous: "bot",
              interactive: "user",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity.github_app_id, "12345");
        assert.strictEqual(identity.github_app_installation_id, "67890");
        assert.strictEqual(identity.github_app_private_key_path, "~/.config/app.pem");
        assert.strictEqual(identity.github_app_slug, "my-bot");
      });

      test("interactive session uses user policy", () => {
        loadRepoConfig({
          identity: {
            bot: {
              github_app_id: "12345",
              github_app_installation_id: "67890",
              github_app_private_key_path: "~/.config/app.pem",
            },
            policy: {
              autonomous: "bot",
              interactive: "user",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "interactive");
        assert.strictEqual(identity, null);
      });
    });

    describe("environment variable expansion", () => {
      test("expands ${VAR} syntax in config values", () => {
        process.env.TEST_APP_KEY = "-----BEGIN RSA PRIVATE KEY-----";

        loadRepoConfig({
          identity: {
            bot: {
              github_app_id: "12345",
              github_app_installation_id: "67890",
              github_app_private_key: "${TEST_APP_KEY}",
            },
            policy: {
              autonomous: "bot",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity.github_app_private_key, "-----BEGIN RSA PRIVATE KEY-----");
      });

      test("returns empty string for missing env vars", () => {
        // Intentionally NOT setting MISSING_VAR

        loadRepoConfig({
          identity: {
            bot: {
              github_app_id: "12345",
              github_app_installation_id: "${MISSING_VAR}",
              github_app_private_key_path: "~/.config/app.pem",
            },
            policy: {
              autonomous: "bot",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity.github_app_installation_id, "");
      });
    });

    describe("repo-level overrides", () => {
      test("repo can override policy", () => {
        loadRepoConfig({
          identity: {
            bot: {
              github_app_id: "12345",
              github_app_installation_id: "67890",
              github_app_private_key_path: "~/.config/app.pem",
            },
            policy: {
              autonomous: "bot",
            },
          },
          repos: {
            "work-org/backend": {
              identity: {
                policy: {
                  autonomous: "user",
                },
              },
            },
          },
        });

        // Work org repos use user policy (override)
        const workIdentity = resolveIdentity("work-org/backend", "autonomous");
        assert.strictEqual(workIdentity, null);
      });
    });

    describe("edge cases", () => {
      test("returns null when bot policy set but no bot config", () => {
        loadRepoConfig({
          identity: {
            policy: {
              autonomous: "bot",
            },
            // Note: no bot config defined
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity, null);
      });

      test("handles unknown policy value", () => {
        loadRepoConfig({
          identity: {
            policy: {
              autonomous: "unknown-policy",
            },
          },
          repos: {
            "myorg/backend": {},
          },
        });

        const identity = resolveIdentity("myorg/backend", "autonomous");
        assert.strictEqual(identity, null);
      });
    });
  });
});
