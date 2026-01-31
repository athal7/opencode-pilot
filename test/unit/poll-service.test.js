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
      
      // Valid MCP config
      const validMcp = {
        name: 'test',
        tool: { mcp: 'github', name: 'search_issues' },
        args: {}
      };
      assert.strictEqual(hasToolConfig(validMcp), true);
      
      // Valid CLI command config
      const validCli = {
        name: 'test',
        tool: { command: ['gh', 'search', 'issues'] },
        args: {}
      };
      assert.strictEqual(hasToolConfig(validCli), true);
      
      // Valid CLI command config (string form)
      const validCliString = {
        name: 'test',
        tool: { command: 'gh search issues' },
        args: {}
      };
      assert.strictEqual(hasToolConfig(validCliString), true);
      
      // Missing tool
      const missingTool = { name: 'test' };
      assert.strictEqual(hasToolConfig(missingTool), false);
      
      // Missing mcp (and no command)
      const missingMcp = { name: 'test', tool: { name: 'search_issues' } };
      assert.strictEqual(hasToolConfig(missingMcp), false);
      
      // Missing tool.name (and no command)
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

  describe('per-item repo resolution', () => {
    test('resolves repo config from item using source.repo template', async () => {
      const config = `
repos:
  myorg/backend:
    path: ~/code/backend
    prompt: worktree
    session:
      name: "issue-{number}"

sources:
  - preset: github/my-issues
`;
      writeFileSync(configPath, config);

      const { loadRepoConfig, getSources, getRepoConfig, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const source = getSources()[0];
      // Item with repository.nameWithOwner (gh CLI output format)
      const item = { 
        repository: { nameWithOwner: 'myorg/backend' },
        number: 123,
        url: 'https://github.com/myorg/backend/issues/123'
      };
      
      // Source should have repo field from preset (uses gh CLI field)
      assert.strictEqual(source.repo, '{repository.nameWithOwner}');
      
      // resolveRepoForItem should extract repo key from item
      const repoKeys = resolveRepoForItem(source, item);
      assert.deepStrictEqual(repoKeys, ['myorg/backend']);
      
      // getRepoConfig should return the repo settings
      const repoConfig = getRepoConfig(repoKeys[0]);
      assert.strictEqual(repoConfig.path, '~/code/backend');
      assert.strictEqual(repoConfig.prompt, 'worktree');
      assert.deepStrictEqual(repoConfig.session, { name: 'issue-{number}' });
    });

    test('falls back gracefully when repo not in config', async () => {
      const config = `
repos:
  myorg/backend:
    path: ~/code/backend

sources:
  - preset: github/my-issues
`;
      writeFileSync(configPath, config);

      const { loadRepoConfig, getSources, getRepoConfig, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const source = getSources()[0];
      // Item with repository.nameWithOwner (gh CLI output format)
      const item = { 
        repository: { nameWithOwner: 'unknown/repo' },
        number: 456
      };
      
      // resolveRepoForItem should extract repo key from item
      const repoKeys = resolveRepoForItem(source, item);
      assert.deepStrictEqual(repoKeys, ['unknown/repo']);
      
      // getRepoConfig should return empty object for unknown repo
      const repoConfig = getRepoConfig(repoKeys[0]);
      assert.deepStrictEqual(repoConfig, {});
    });
  });

  describe('buildActionConfigForItem', () => {
    test('uses repo config resolved from item', async () => {
      const config = `
repos:
  myorg/backend:
    path: ~/code/backend
    prompt: repo-prompt
    session:
      name: "issue-{number}"

sources:
  - preset: github/my-issues
    prompt: source-prompt
`;
      writeFileSync(configPath, config);

      const { loadRepoConfig } = await import('../../service/repo-config.js');
      const { buildActionConfigForItem } = await import('../../service/poll-service.js');
      loadRepoConfig(configPath);
      
      const source = {
        name: 'my-issues',
        repo: '{repository.full_name}',
        prompt: 'source-prompt'
      };
      const item = { 
        repository: { full_name: 'myorg/backend' },
        number: 123
      };
      
      const actionConfig = buildActionConfigForItem(source, item);
      
      // Should use repo path from repos config
      assert.strictEqual(actionConfig.repo_path, '~/code/backend');
      // Source prompt should override repo prompt
      assert.strictEqual(actionConfig.prompt, 'source-prompt');
      // Session should come from repo config
      assert.deepStrictEqual(actionConfig.session, { name: 'issue-{number}' });
    });

    test('falls back to source working_dir when repo not configured', async () => {
      const config = `
sources:
  - preset: github/my-issues
    working_dir: ~/default/path
`;
      writeFileSync(configPath, config);

      const { loadRepoConfig } = await import('../../service/repo-config.js');
      const { buildActionConfigForItem } = await import('../../service/poll-service.js');
      loadRepoConfig(configPath);
      
      const source = {
        name: 'my-issues',
        repo: '{repository.full_name}',
        working_dir: '~/default/path'
      };
      const item = { 
        repository: { full_name: 'unknown/repo' },
        number: 456
      };
      
      const actionConfig = buildActionConfigForItem(source, item);
      
      // Should use source working_dir since repo not in config
      assert.strictEqual(actionConfig.working_dir, '~/default/path');
    });
  });
});
