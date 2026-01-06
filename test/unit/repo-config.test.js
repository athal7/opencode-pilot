/**
 * Tests for repo-config.js - configuration for repos, sources, tools, templates
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

    test('resolves multiple repos from repos array', async () => {
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

      assert.deepStrictEqual(repos, ['myorg/backend', 'myorg/frontend']);
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
});
