/**
 * Tests for poll-service.js - Polling orchestration
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveAssignee, hasToolConfig, buildActionConfigFromSource } from "../../service/poll-service.js";
import { loadRepoConfig, clearConfigCache, getAllSources } from "../../service/repo-config.js";

describe('poll-service.js', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-poll-service-test-'));
    configPath = join(tempDir, 'config.yaml');
    clearConfigCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('source configuration', () => {
    test('parses sources with tool.mcp and tool.name', async () => {
      const config = `
sources:
  - name: my-issues
    tool:
      mcp: github
      name: search_issues
    args:
      q: "is:issue assignee:@me"
    item:
      id: "{html_url}"
`;
      writeFileSync(configPath, config);

      loadRepoConfig(configPath);
      const sources = getAllSources();
      
      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'my-issues');
      assert.ok(sources[0].tool, 'Source should have tool config');
      assert.strictEqual(sources[0].tool.mcp, 'github');
      assert.strictEqual(sources[0].tool.name, 'search_issues');
    });

    test('hasToolConfig validates source configuration', async () => {
      // Valid config
      const valid = {
        name: 'test',
        tool: { mcp: 'github', name: 'search_issues' },
        args: {}
      };
      assert.strictEqual(hasToolConfig(valid), true);
      
      // Missing tool
      const missingTool = { name: 'test' };
      assert.strictEqual(hasToolConfig(missingTool), false);
      
      // Missing mcp
      const missingMcp = { name: 'test', tool: { name: 'search_issues' } };
      assert.strictEqual(hasToolConfig(missingMcp), false);
      
      // Missing tool.name
      const missingName = { name: 'test', tool: { mcp: 'github' } };
      assert.strictEqual(hasToolConfig(missingName), false);
    });
  });

  describe('buildActionConfigFromSource', () => {
    test('includes source-level agent, model, prompt, and working_dir', async () => {
      const source = {
        name: 'test-source',
        agent: 'plan',
        model: 'claude-opus',
        prompt: 'devcontainer',
        working_dir: '~/code/project',
        session: { name: 'issue-{number}' }
      };
      const repoConfig = {
        path: '~/code/default',
        prompt: 'default'
      };
      
      const config = buildActionConfigFromSource(source, repoConfig);
      
      assert.strictEqual(config.agent, 'plan');
      assert.strictEqual(config.model, 'claude-opus');
      assert.strictEqual(config.prompt, 'devcontainer');
      assert.strictEqual(config.working_dir, '~/code/project');
      assert.deepStrictEqual(config.session, { name: 'issue-{number}' });
    });

    test('falls back to repoConfig when source fields missing', async () => {
      const source = {
        name: 'test-source'
        // No agent, model, prompt, working_dir
      };
      const repoConfig = {
        path: '~/code/default',
        prompt: 'default',
        session: { name: 'default-{number}' }
      };
      
      const config = buildActionConfigFromSource(source, repoConfig);
      
      assert.strictEqual(config.prompt, 'default');
      assert.strictEqual(config.repo_path, '~/code/default');
      assert.deepStrictEqual(config.session, { name: 'default-{number}' });
    });

    test('source fields override repoConfig fields', async () => {
      const source = {
        name: 'test-source',
        prompt: 'review',
        agent: 'code'
      };
      const repoConfig = {
        path: '~/code/default',
        prompt: 'default',
        agent: 'plan'  // Should be overridden
      };
      
      const config = buildActionConfigFromSource(source, repoConfig);
      
      assert.strictEqual(config.prompt, 'review');
      assert.strictEqual(config.agent, 'code');
    });
  });

  describe("resolveAssignee", () => {
    test("returns assignee unchanged when not @bot", () => {
      const result = resolveAssignee("@me", "myorg/backend");
      assert.strictEqual(result, "@me");
    });

    test("returns specific username unchanged", () => {
      const result = resolveAssignee("someuser", "myorg/backend");
      assert.strictEqual(result, "someuser");
    });

    test("resolves @bot to github_app_slug[bot]", () => {
      loadRepoConfig({
        identity: {
          bot: {
            github_app_id: "123",
            github_app_installation_id: "456",
            github_app_private_key: "key",
            github_app_slug: "my-pilot-app",
          },
          policy: {
            autonomous: "bot",
          },
        },
        repos: {
          "myorg/backend": {},
        },
      });

      const result = resolveAssignee("@bot", "myorg/backend");
      assert.strictEqual(result, "my-pilot-app[bot]");
    });

    test("returns @bot unchanged when no github_app_slug configured", () => {
      loadRepoConfig({
        identity: {
          bot: {
            github_app_id: "123",
            github_app_installation_id: "456",
            github_app_private_key: "key",
            // No github_app_slug
          },
          policy: {
            autonomous: "bot",
          },
        },
        repos: {
          "myorg/backend": {},
        },
      });

      const result = resolveAssignee("@bot", "myorg/backend");
      assert.strictEqual(result, "@bot"); // Falls back unchanged
    });

    test("returns @bot unchanged when no identity configured", () => {
      loadRepoConfig({
        repos: {
          "myorg/backend": {},
        },
      });

      const result = resolveAssignee("@bot", "myorg/backend");
      assert.strictEqual(result, "@bot"); // Falls back unchanged
    });
  });
});
