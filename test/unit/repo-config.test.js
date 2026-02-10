/**
 * Tests for repo-config.js - configuration for repos, sources, tools, templates
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('repo-config.js', () => {
  let tempDir;
  let configPath;
  let templatesDir;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-test-'));
    configPath = join(tempDir, 'config.yaml');
    templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir);
    
    // Clear module cache to get fresh config each test
    const { clearConfigCache } = await import('../../service/repo-config.js');
    clearConfigCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('error handling', () => {
    test('handles malformed YAML gracefully', async () => {
      // Write invalid YAML (unbalanced quotes)
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: "~/code/backend
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      
      // Should not throw, should return empty
      loadRepoConfig(configPath);
      const sources = getSources();
      
      assert.deepStrictEqual(sources, []);
    });

    test('handles empty file gracefully', async () => {
      writeFileSync(configPath, '');

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();
      
      assert.deepStrictEqual(sources, []);
    });
  });

  describe('repos', () => {
    test('gets repo config with path', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const config = getRepoConfig('myorg/backend');

      assert.strictEqual(config.path, '~/code/backend');
      assert.strictEqual(config.repo_path, '~/code/backend');
    });

    test('returns empty object for unknown repo', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const config = getRepoConfig('unknown/repo');

      assert.deepStrictEqual(config, {});
    });

    test('supports YAML anchors for shared config', async () => {
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

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
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

  describe('repos_dir auto-discovery', () => {
    let reposDir;

    beforeEach(() => {
      reposDir = join(tempDir, 'code');
      mkdirSync(reposDir);
    });

    function createGitRepo(name, remoteUrl) {
      const repoPath = join(reposDir, name);
      mkdirSync(repoPath);
      execSync('git init', { cwd: repoPath, stdio: 'ignore' });
      execSync(`git remote add origin ${remoteUrl}`, { cwd: repoPath, stdio: 'ignore' });
      return repoPath;
    }

    test('discovers repos from git remote origin', async () => {
      const repoPath = createGitRepo('my-project', 'https://github.com/myorg/my-project.git');

      writeFileSync(configPath, `
repos_dir: ${reposDir}
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const config = getRepoConfig('myorg/my-project');
      assert.strictEqual(config.path, repoPath);
      assert.strictEqual(config.repo_path, repoPath);
    });

    test('handles SSH git URLs', async () => {
      const repoPath = createGitRepo('backend', 'git@github.com:myorg/backend.git');

      writeFileSync(configPath, `
repos_dir: ${reposDir}
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const config = getRepoConfig('myorg/backend');
      assert.strictEqual(config.path, repoPath);
    });

    test('explicit repos override auto-discovered', async () => {
      createGitRepo('my-project', 'https://github.com/myorg/my-project.git');

      writeFileSync(configPath, `
repos_dir: ${reposDir}
repos:
  myorg/my-project:
    path: /custom/path
    prompt: custom
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const config = getRepoConfig('myorg/my-project');
      // Explicit config should win
      assert.strictEqual(config.path, '/custom/path');
      assert.strictEqual(config.prompt, 'custom');
    });

    test('skips directories without .git', async () => {
      const notARepo = join(reposDir, 'not-a-repo');
      mkdirSync(notARepo);
      writeFileSync(join(notARepo, 'file.txt'), 'hello');

      writeFileSync(configPath, `
repos_dir: ${reposDir}
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      // Should not find this as a repo
      const config = getRepoConfig('not-a-repo');
      assert.deepStrictEqual(config, {});
    });

    test('returns empty for unknown repo even with repos_dir', async () => {
      createGitRepo('my-project', 'https://github.com/myorg/my-project.git');

      writeFileSync(configPath, `
repos_dir: ${reposDir}
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const config = getRepoConfig('unknown/repo');
      assert.deepStrictEqual(config, {});
    });

    test('discovers repos from upstream remote for fork workflows', async () => {
      // Create a repo with both origin (fork) and upstream (original) remotes
      const repoPath = join(reposDir, 'opencode');
      mkdirSync(repoPath);
      execSync('git init', { cwd: repoPath, stdio: 'ignore' });
      execSync('git remote add origin https://github.com/athal7/opencode.git', { cwd: repoPath, stdio: 'ignore' });
      execSync('git remote add upstream https://github.com/anomalyco/opencode.git', { cwd: repoPath, stdio: 'ignore' });

      writeFileSync(configPath, `
repos_dir: ${reposDir}
`);

      const { loadRepoConfig, getRepoConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      // Both the fork (origin) and original (upstream) should resolve to the same local path
      const forkConfig = getRepoConfig('athal7/opencode');
      const upstreamConfig = getRepoConfig('anomalyco/opencode');
      
      assert.strictEqual(forkConfig.path, repoPath, 'fork (origin) should resolve');
      assert.strictEqual(upstreamConfig.path, repoPath, 'upstream should also resolve');
    });

  });

  describe('sources', () => {
    test('returns sources array from top-level', async () => {
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

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'my-issues');
      assert.deepStrictEqual(sources[0].tool, { mcp: 'github', name: 'github_search_issues' });
      assert.strictEqual(sources[0].args.q, 'is:issue assignee:@me');
    });

    test('returns empty array when no sources', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.deepStrictEqual(sources, []);
    });

    test('source can reference workflow settings', async () => {
      writeFileSync(configPath, `
sources:
  - name: reviews
    tool:
      mcp: github
      name: github_search_issues
    args:
      q: "is:pr review-requested:@me"
    item:
      id: "github:{repository.full_name}#{number}"
    repo: "{repository.full_name}"
    prompt: review
    agent: reviewer
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].prompt, 'review');
      assert.strictEqual(sources[0].agent, 'reviewer');
    });

    test('source can specify multiple repos with working_dir', async () => {
      writeFileSync(configPath, `
sources:
  - name: cross-repo
    tool:
      mcp: github
      name: github_search_issues
    args:
      q: "is:issue label:multi-repo"
    item:
      id: "github:{number}"
    repos:
      - myorg/backend
      - myorg/frontend
    working_dir: ~/code
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.deepStrictEqual(sources[0].repos, ['myorg/backend', 'myorg/frontend']);
      assert.strictEqual(sources[0].working_dir, '~/code');
    });

    test('supports YAML anchors for shared source config', async () => {
      writeFileSync(configPath, `
sources:
  - name: my-issues
    tool: &github-tool
      mcp: github
      name: github_search_issues
    args:
      q: "is:issue assignee:@me"
    item: &github-item
      id: "github:{repository.full_name}#{number}"
    repo: "{repository.full_name}"

  - name: review-requests
    tool: *github-tool
    args:
      q: "is:pr review-requested:@me"
    item: *github-item
    repo: "{repository.full_name}"
    prompt: review
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 2);
      // Both use same tool config via anchor
      assert.deepStrictEqual(sources[0].tool, sources[1].tool);
      assert.deepStrictEqual(sources[0].item, sources[1].item);
      // But have different args and prompts
      assert.notStrictEqual(sources[0].args.q, sources[1].args.q);
      assert.strictEqual(sources[1].prompt, 'review');
    });
  });

  describe('templates', () => {
    test('loads template from templates directory', async () => {
      writeFileSync(join(templatesDir, 'default.md'), '{title}\n\n{body}');

      const { getTemplate } = await import('../../service/repo-config.js');
      const template = getTemplate('default', templatesDir);

      assert.strictEqual(template, '{title}\n\n{body}');
    });

    test('returns null for missing template', async () => {
      const { getTemplate } = await import('../../service/repo-config.js');
      const template = getTemplate('nonexistent', templatesDir);

      assert.strictEqual(template, null);
    });
  });

  describe('tools mappings', () => {
    test('returns mappings for a tool provider', async () => {
      writeFileSync(configPath, `
tools:
  linear:
    mappings:
      number: identifier
      body: description

sources: []
`);

      const { loadRepoConfig, getToolMappings } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const mappings = getToolMappings('linear');
      
      assert.deepStrictEqual(mappings, {
        number: 'identifier',
        body: 'description'
      });
    });

    test('returns null for unknown provider', async () => {
      writeFileSync(configPath, `
tools:
  github:
    mappings:
      url: html_url

sources: []
`);

      const { loadRepoConfig, getToolMappings } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const mappings = getToolMappings('unknown');
      
      assert.strictEqual(mappings, null);
    });

    test('returns null when no tools section', async () => {
      writeFileSync(configPath, `
sources: []
`);

      const { loadRepoConfig, getToolMappings } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const mappings = getToolMappings('github');
      
      assert.strictEqual(mappings, null);
    });

    test('getToolProviderConfig returns full tool config with response_key', async () => {
      writeFileSync(configPath, `
tools:
  apple-reminders:
    response_key: reminders
    mappings:
      body: notes

sources: []
`);

      const { loadRepoConfig, getToolProviderConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const toolConfig = getToolProviderConfig('apple-reminders');
      
      assert.strictEqual(toolConfig.response_key, 'reminders');
      assert.deepStrictEqual(toolConfig.mappings, { body: 'notes' });
    });

    test('getToolProviderConfig returns config without response_key', async () => {
      writeFileSync(configPath, `
tools:
  github:
    mappings:
      custom_field: some_source

sources: []
`);

      const { loadRepoConfig, getToolProviderConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const toolConfig = getToolProviderConfig('github');
      
      // GitHub preset now uses gh CLI and doesn't need response_key
      // User config custom_field should be merged with preset mappings
      assert.strictEqual(toolConfig.mappings.custom_field, 'some_source');
      // GitHub provider has mappings for gh CLI field normalization
      assert.ok(toolConfig.mappings.html_url, 'Should have html_url mapping');
      assert.ok(toolConfig.mappings.repository_full_name, 'Should have repository_full_name mapping');
    });

    test('getToolProviderConfig falls back to preset provider config', async () => {
      writeFileSync(configPath, `
sources: []
`);

      const { loadRepoConfig, getToolProviderConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      // Linear preset has provider config with response_key and mappings
      const toolConfig = getToolProviderConfig('linear');
      
      assert.strictEqual(toolConfig.response_key, 'nodes');
      assert.strictEqual(toolConfig.mappings.body, 'title');
      assert.strictEqual(toolConfig.mappings.number, 'url:/([A-Z0-9]+-[0-9]+)/');
    });

    test('getToolProviderConfig merges user config with preset defaults', async () => {
      writeFileSync(configPath, `
tools:
  linear:
    mappings:
      custom_field: some_source

sources: []
`);

      const { loadRepoConfig, getToolProviderConfig } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const toolConfig = getToolProviderConfig('linear');
      
      // Should have preset response_key
      assert.strictEqual(toolConfig.response_key, 'nodes');
      // Should have preset mappings plus user mappings
      assert.strictEqual(toolConfig.mappings.body, 'title');
      assert.strictEqual(toolConfig.mappings.custom_field, 'some_source');
    });
  });

  describe('repo resolution for sources', () => {
    test('resolves repo from simple field reference', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend

sources:
  - name: my-issues
    tool:
      mcp: github
      name: github_search_issues
    args:
      q: "is:issue"
    item:
      id: "github:{number}"
    repo: "{repository.full_name}"
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const source = getSources()[0];
      const item = { repository: { full_name: 'myorg/backend' }, number: 123 };
      const repos = resolveRepoForItem(source, item);

      assert.deepStrictEqual(repos, ['myorg/backend']);
    });

    test('repos array without repo template returns empty (needs item context)', async () => {
      writeFileSync(configPath, `
sources:
  - name: cross-repo
    tool:
      mcp: github
      name: github_search_issues
    item:
      id: "github:{number}"
    repos:
      - myorg/backend
      - myorg/frontend
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const source = getSources()[0];
      const item = { number: 123 };
      const repos = resolveRepoForItem(source, item);

      // Without a repo template, can't resolve from item - returns empty
      assert.deepStrictEqual(repos, []);
    });

    test('returns empty array when no repo config', async () => {
      writeFileSync(configPath, `
sources:
  - name: personal-todos
    tool:
      mcp: reminders
      name: list_reminders
    item:
      id: "reminder:{id}"
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      const source = getSources()[0];
      const item = { id: 'abc123' };
      const repos = resolveRepoForItem(source, item);

      assert.deepStrictEqual(repos, []);
    });
  });

  describe('listRepos', () => {
    test('lists all configured repos', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
  myorg/frontend:
    path: ~/code/frontend
`);

      const { loadRepoConfig, listRepos } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const repos = listRepos();

      assert.deepStrictEqual(repos, ['myorg/backend', 'myorg/frontend']);
    });
  });

  describe('findRepoByPath', () => {
    test('finds repo by path', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      const { loadRepoConfig, findRepoByPath } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const repoKey = findRepoByPath('~/code/backend');

      assert.strictEqual(repoKey, 'myorg/backend');
    });

    test('returns null for unknown path', async () => {
      writeFileSync(configPath, `
repos:
  myorg/backend:
    path: ~/code/backend
`);

      const { loadRepoConfig, findRepoByPath } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const repoKey = findRepoByPath('~/code/unknown');

      assert.strictEqual(repoKey, null);
    });
  });

  describe('presets', () => {
    test('expands github/my-issues preset', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
    prompt: worktree
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'github-my-issues');
      // GitHub presets now use gh CLI instead of MCP
      assert.ok(Array.isArray(sources[0].tool.command), 'tool.command should be an array');
      assert.ok(sources[0].tool.command.includes('gh'), 'command should use gh CLI');
      assert.strictEqual(sources[0].item.id, '{url}');
      assert.strictEqual(sources[0].prompt, 'worktree');
    });

    test('expands github/review-requests preset', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/review-requests
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].name, 'review-requests');
      // GitHub presets now use gh CLI instead of MCP
      assert.ok(sources[0].tool.command.includes('--review-requested=@me'), 'command should include review-requested filter');
    });

    test('expands github/my-prs-attention preset', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-prs-attention
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].name, 'my-prs-attention');
      // GitHub presets now use gh CLI instead of MCP
      assert.ok(sources[0].tool.command.includes('--author=@me'), 'command should include author filter');
      // This preset enables both mergeable and comments enrichment
      assert.strictEqual(sources[0].enrich_mergeable, true);
      assert.strictEqual(sources[0].filter_bot_comments, true);
      // This preset requires attention (conflicts OR human feedback)
      assert.strictEqual(sources[0].readiness.require_attention, true);
      // Session name uses dynamic attention label
      assert.ok(sources[0].session.name.includes('_attention_label'), 'session name should use dynamic label');
    });

    test('expands linear/my-issues preset with required args', async () => {
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    args:
      teamId: "team-uuid-123"
      assigneeId: "user-uuid-456"
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].name, 'linear-my-issues');
      assert.deepStrictEqual(sources[0].tool, { mcp: 'linear', name: 'list_issues' });
      assert.strictEqual(sources[0].args.teamId, 'team-uuid-123');
      assert.strictEqual(sources[0].args.assigneeId, 'user-uuid-456');
    });

    test('user config overrides preset values', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
    name: custom-name
    args:
      q: "is:issue assignee:@me state:open label:urgent"
    agent: plan
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].name, 'custom-name');
      assert.strictEqual(sources[0].args.q, 'is:issue assignee:@me state:open label:urgent');
      assert.strictEqual(sources[0].agent, 'plan');
    });

    test('throws error for unknown preset', async () => {
      writeFileSync(configPath, `
sources:
  - preset: unknown/preset
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      
      assert.throws(() => getSources(), /Unknown preset: unknown\/preset/);
    });

    test('github presets include repo field for automatic resolution', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
  - preset: github/review-requests
  - preset: github/my-prs-attention
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // All GitHub presets should have repo field that references repository.nameWithOwner
      // (gh CLI returns this field directly)
      const mockItem = { repository: { nameWithOwner: 'myorg/backend' } };
      
      for (const source of sources) {
        assert.strictEqual(source.repo, '{repository.nameWithOwner}', `Preset ${source.name} should have repo field`);
        const repos = resolveRepoForItem(source, mockItem);
        assert.deepStrictEqual(repos, ['myorg/backend'], `Preset ${source.name} should resolve repo from item`);
      }
    });

    test('source.repos acts as allowlist filter', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
    repos:
      - myorg/backend
      - myorg/frontend
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const source = getSources()[0];

      // Item from allowed repo should resolve (gh CLI returns repository.nameWithOwner)
      const allowedItem = { repository: { nameWithOwner: 'myorg/backend' } };
      assert.deepStrictEqual(resolveRepoForItem(source, allowedItem), ['myorg/backend']);

      // Item from non-allowed repo should return empty (filtered out)
      const filteredItem = { repository: { nameWithOwner: 'other/repo' } };
      assert.deepStrictEqual(resolveRepoForItem(source, filteredItem), []);
    });

    test('single-repo allowlist uses repo as default when no template', async () => {
      // Linear issues don't have repository context - when exactly one repo is configured,
      // use it as the default for all items from that source
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    repos:
      - 0din-ai/odin
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const source = getSources()[0];

      // Linear items don't have repository field
      const linearItem = { id: 'linear:abc123', title: 'Fix bug', state: { name: 'In Progress' } };
      assert.deepStrictEqual(resolveRepoForItem(source, linearItem), ['0din-ai/odin'],
        'single-repo allowlist should use repo as default');
    });

    test('multi-repo allowlist returns empty when no template match', async () => {
      // With multiple repos and no way to determine which one, return empty
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    repos:
      - org/repo-a
      - org/repo-b
`);

      const { loadRepoConfig, getSources, resolveRepoForItem } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const source = getSources()[0];

      // Can't determine which of the 2 repos to use
      const linearItem = { id: 'linear:abc123', title: 'Fix bug' };
      assert.deepStrictEqual(resolveRepoForItem(source, linearItem), [],
        'multi-repo allowlist should return empty when no template');
    });

    test('github presets include semantic session names', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
  - preset: github/review-requests
  - preset: github/my-prs-attention
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // my-issues: just the title
      assert.strictEqual(sources[0].session.name, '{title}', 'my-issues should use title');
      
      // review-requests: "Review: {title}"
      assert.strictEqual(sources[1].session.name, 'Review: {title}', 'review-requests should prefix with Review:');
      
      // my-prs-attention: "{_attention_label}: {title}" (dynamic based on detected conditions)
      assert.ok(sources[2].session.name.includes('_attention_label'), 'my-prs-attention should use dynamic label');
    });

    test('linear preset includes session name', async () => {
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    args:
      teamId: "team-uuid"
      assigneeId: "user-uuid"
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].session.name, '{title}', 'linear preset should use title');
    });

    test('github presets include worktree_name for sandbox reuse', async () => {
      writeFileSync(configPath, `
sources:
  - preset: github/my-issues
  - preset: github/review-requests
  - preset: github/my-prs-attention
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // my-issues: worktree_name: "issue-{number}"
      assert.strictEqual(sources[0].worktree_name, 'issue-{number}', 'my-issues should use issue-{number}');
      
      // review-requests: worktree_name: "pr-{number}"
      assert.strictEqual(sources[1].worktree_name, 'pr-{number}', 'review-requests should use pr-{number}');
      
      // my-prs-attention: worktree_name: "pr-{number}"
      assert.strictEqual(sources[2].worktree_name, 'pr-{number}', 'my-prs-attention should use pr-{number}');
    });

    test('linear preset includes worktree_name for sandbox reuse', async () => {
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    args:
      teamId: "team-uuid"
      assigneeId: "user-uuid"
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // linear uses the issue identifier (e.g., "ABC-123")
      assert.strictEqual(sources[0].worktree_name, '{number}', 'linear preset should use {number} (identifier)');
    });

    test('all preset names are globally unique (no cross-provider collisions)', async () => {
      const { listPresets, expandPreset } = await import('../../service/presets/index.js');
      const presets = listPresets();
      
      const nameToPreset = new Map();
      for (const presetKey of presets) {
        const expanded = expandPreset(presetKey, {});
        const name = expanded.name;
        
        assert.ok(!nameToPreset.has(name),
          `Duplicate source name "${name}" from presets "${nameToPreset.get(name)}" and "${presetKey}". ` +
          `Source names must be unique to prevent cross-source pollution in poll state tracking.`);
        nameToPreset.set(name, presetKey);
      }
    });

    test('github and linear my-issues presets have distinct names when used together', async () => {
      writeFileSync(configPath, `
sources:
  - preset: linear/my-issues
    args:
      teamId: "team-uuid"
      assigneeId: "user-uuid"
  - preset: github/my-issues
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 2);
      assert.notStrictEqual(sources[0].name, sources[1].name,
        'Linear and GitHub my-issues presets must have different names');
      assert.strictEqual(sources[0].name, 'linear-my-issues');
      assert.strictEqual(sources[1].name, 'github-my-issues');
    });

  });

  describe('shorthand syntax', () => {
    test('expands github shorthand to full source', async () => {
      writeFileSync(configPath, `
sources:
  - name: my-issues
    github: "is:issue assignee:@me state:open"
    prompt: worktree
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources.length, 1);
      assert.strictEqual(sources[0].name, 'my-issues');
      assert.deepStrictEqual(sources[0].tool, { mcp: 'github', name: 'search_issues' });
      assert.strictEqual(sources[0].args.q, 'is:issue assignee:@me state:open');
      assert.strictEqual(sources[0].item.id, '{html_url}');
      assert.strictEqual(sources[0].prompt, 'worktree');
    });

    test('shorthand works with other source fields', async () => {
      writeFileSync(configPath, `
sources:
  - name: urgent-issues
    github: "is:issue assignee:@me label:urgent"
    agent: plan
    working_dir: ~/code/myproject
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].agent, 'plan');
      assert.strictEqual(sources[0].working_dir, '~/code/myproject');
    });
  });

  describe('defaults section', () => {
    test('applies defaults to sources without those fields', async () => {
      writeFileSync(configPath, `
defaults:
  agent: plan
  prompt: default

sources:
  - preset: github/my-issues
  - preset: github/review-requests
    prompt: review
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // First source gets both defaults
      assert.strictEqual(sources[0].agent, 'plan');
      assert.strictEqual(sources[0].prompt, 'default');
      
      // Second source overrides prompt but gets agent default
      assert.strictEqual(sources[1].agent, 'plan');
      assert.strictEqual(sources[1].prompt, 'review');
    });

    test('source values override defaults', async () => {
      writeFileSync(configPath, `
defaults:
  agent: plan
  model: claude-3-sonnet

sources:
  - preset: github/my-issues
    agent: architect
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      assert.strictEqual(sources[0].agent, 'architect');
      assert.strictEqual(sources[0].model, 'claude-3-sonnet');
    });

    test('defaults model flows through to sources', async () => {
      writeFileSync(configPath, `
defaults:
  model: anthropic/claude-haiku-3.5

sources:
  - preset: github/my-issues
  - preset: github/review-requests
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // Both sources should inherit model from defaults
      assert.strictEqual(sources[0].model, 'anthropic/claude-haiku-3.5');
      assert.strictEqual(sources[1].model, 'anthropic/claude-haiku-3.5');
    });

    test('source model overrides defaults model', async () => {
      writeFileSync(configPath, `
defaults:
  model: anthropic/claude-haiku-3.5

sources:
  - preset: github/my-issues
    model: anthropic/claude-sonnet-4-20250514
  - preset: github/review-requests
`);

      const { loadRepoConfig, getSources } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const sources = getSources();

      // First source overrides, second inherits
      assert.strictEqual(sources[0].model, 'anthropic/claude-sonnet-4-20250514');
      assert.strictEqual(sources[1].model, 'anthropic/claude-haiku-3.5');
    });

    test('getDefaults returns defaults section', async () => {
      writeFileSync(configPath, `
defaults:
  agent: plan
  prompt: default
  working_dir: ~/code
`);

      const { loadRepoConfig, getDefaults } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const defaults = getDefaults();

      assert.strictEqual(defaults.agent, 'plan');
      assert.strictEqual(defaults.prompt, 'default');
      assert.strictEqual(defaults.working_dir, '~/code');
    });

    test('getDefaults returns empty object when no defaults', async () => {
      writeFileSync(configPath, `
sources: []
`);

      const { loadRepoConfig, getDefaults } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const defaults = getDefaults();

      assert.deepStrictEqual(defaults, {});
    });
  });

  describe('cleanup config', () => {
    test('getCleanupTtlDays returns configured value', async () => {
      writeFileSync(configPath, `
cleanup:
  ttl_days: 14

sources: []
`);

      const { loadRepoConfig, getCleanupTtlDays } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const ttlDays = getCleanupTtlDays();

      assert.strictEqual(ttlDays, 14);
    });

    test('getCleanupTtlDays returns default 30 when not configured', async () => {
      writeFileSync(configPath, `
sources: []
`);

      const { loadRepoConfig, getCleanupTtlDays } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const ttlDays = getCleanupTtlDays();

      assert.strictEqual(ttlDays, 30);
    });

    test('getCleanupTtlDays returns default 30 when cleanup section exists but ttl_days not set', async () => {
      writeFileSync(configPath, `
cleanup:
  some_other_option: true

sources: []
`);

      const { loadRepoConfig, getCleanupTtlDays } = await import('../../service/repo-config.js');
      loadRepoConfig(configPath);
      const ttlDays = getCleanupTtlDays();

      assert.strictEqual(ttlDays, 30);
    });
  });
});
