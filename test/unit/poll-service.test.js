/**
 * Tests for poll-service.js
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('poll-service.js', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-poll-service-test-'));
    configPath = join(tempDir, 'config.yaml');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
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

      const { loadRepoConfig, getAllSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getAllSources();
      
      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'my-issues');
      assert.ok(sources[0].tool, 'Source should have tool config');
      assert.strictEqual(sources[0].tool.mcp, 'github');
      assert.strictEqual(sources[0].tool.name, 'search_issues');
    });

    test('hasToolConfig validates source configuration', async () => {
      const { hasToolConfig } = await import('../../service/poll-service.js');
      
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
      const { buildActionConfigFromSource } = await import('../../service/poll-service.js');
      
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
      const { buildActionConfigFromSource } = await import('../../service/poll-service.js');
      
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
      const { buildActionConfigFromSource } = await import('../../service/poll-service.js');
      
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
});
