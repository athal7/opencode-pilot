/**
 * Tests for actions.js - session creation with new config format
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('actions.js', () => {
  let tempDir;
  let templatesDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-actions-test-'));
    templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('expandTemplate', () => {
    test('expands simple placeholders', async () => {
      const { expandTemplate } = await import('../../service/actions.js');
      
      const result = expandTemplate('{title}\n\n{body}', {
        title: 'Fix bug',
        body: 'The bug is bad'
      });
      
      assert.strictEqual(result, 'Fix bug\n\nThe bug is bad');
    });

    test('preserves unmatched placeholders', async () => {
      const { expandTemplate } = await import('../../service/actions.js');
      
      const result = expandTemplate('{title}\n\n{missing}', {
        title: 'Fix bug'
      });
      
      assert.strictEqual(result, 'Fix bug\n\n{missing}');
    });

    test('expands nested field references', async () => {
      const { expandTemplate } = await import('../../service/actions.js');
      
      const result = expandTemplate('Repo: {repository.full_name}', {
        repository: { full_name: 'athal7/opencode-pilot' }
      });
      
      assert.strictEqual(result, 'Repo: athal7/opencode-pilot');
    });

    test('preserves unmatched nested placeholders', async () => {
      const { expandTemplate } = await import('../../service/actions.js');
      
      const result = expandTemplate('{team.name}', {
        team: {}
      });
      
      assert.strictEqual(result, '{team.name}');
    });
  });

  describe('buildPromptFromTemplate', () => {
    test('loads template from file and expands', async () => {
      writeFileSync(join(templatesDir, 'default.md'), '{title}\n\n{body}');
      
      const { buildPromptFromTemplate } = await import('../../service/actions.js');
      
      const item = { title: 'Fix bug', body: 'Details here' };
      const prompt = buildPromptFromTemplate('default', item, templatesDir);
      
      assert.strictEqual(prompt, 'Fix bug\n\nDetails here');
    });

    test('returns fallback when template not found', async () => {
      const { buildPromptFromTemplate } = await import('../../service/actions.js');
      
      const item = { title: 'Fix bug', body: 'Details here' };
      const prompt = buildPromptFromTemplate('nonexistent', item, templatesDir);
      
      // Should fall back to title + body
      assert.strictEqual(prompt, 'Fix bug\n\nDetails here');
    });

    test('handles item with only title', async () => {
      const { buildPromptFromTemplate } = await import('../../service/actions.js');
      
      const item = { title: 'Fix bug' };
      const prompt = buildPromptFromTemplate('nonexistent', item, templatesDir);
      
      assert.strictEqual(prompt, 'Fix bug');
    });
  });

  describe('getActionConfig', () => {
    test('merges source, repo, and defaults', async () => {
      const { getActionConfig } = await import('../../service/actions.js');
      
      const source = {
        name: 'my-issues',
        prompt: 'custom',
        agent: 'reviewer'
      };
      const repoConfig = {
        path: '~/code/backend',
        session: { name: 'issue-{number}' }
      };
      const defaults = {
        prompt: 'default',
        working_dir: '~'
      };
      
      const config = getActionConfig(source, repoConfig, defaults);
      
      // Source overrides
      assert.strictEqual(config.prompt, 'custom');
      assert.strictEqual(config.agent, 'reviewer');
      // Repo config
      assert.strictEqual(config.path, '~/code/backend');
      assert.strictEqual(config.session.name, 'issue-{number}');
    });

    test('falls back to defaults when no source/repo overrides', async () => {
      const { getActionConfig } = await import('../../service/actions.js');
      
      const source = { name: 'my-issues' };
      const repoConfig = {};
      const defaults = {
        prompt: 'default',
        working_dir: '~/scratch'
      };
      
      const config = getActionConfig(source, repoConfig, defaults);
      
      assert.strictEqual(config.prompt, 'default');
      assert.strictEqual(config.working_dir, '~/scratch');
    });

    test('source working_dir overrides repo path', async () => {
      const { getActionConfig } = await import('../../service/actions.js');
      
      const source = {
        name: 'cross-repo',
        working_dir: '~/workspaces'
      };
      const repoConfig = {
        path: '~/code/backend'
      };
      const defaults = {};
      
      const config = getActionConfig(source, repoConfig, defaults);
      
      assert.strictEqual(config.working_dir, '~/workspaces');
    });

  });

  describe('buildCommand', () => {
    test('builds display string for API call', async () => {
      const { buildCommand } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: '~/code/backend',
        session: { name: 'issue-{number}' }
      };
      
      const result = buildCommand(item, config);
      
      assert.ok(result.includes('[API]'), 'Should indicate API call');
      assert.ok(result.includes('/session'), 'Should include session endpoint');
      assert.ok(result.includes('issue-123'), 'Should include expanded session name');
    });

    test('shows (no path) when path not configured', async () => {
      const { buildCommand } = await import('../../service/actions.js');
      
      const item = { title: 'Do something' };
      const config = { prompt: 'default' };
      
      const result = buildCommand(item, config);
      
      assert.ok(result.includes('(no path)'), 'Should indicate missing path');
    });
  });

  describe('discoverOpencodeServer', () => {
    test('returns null when no servers running', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      // Mock with empty port list
      const result = await discoverOpencodeServer('/some/path', { getPorts: async () => [] });
      
      assert.strictEqual(result, null);
    });

    test('returns matching server URL for exact worktree match', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj-a', worktree: '/Users/test/project-a', sandboxes: [], time: { created: 1 } }) };
        }
        if (url === 'http://localhost:4000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj-b', worktree: '/Users/test/project-b', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project-b', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:4000');
    });

    test('returns matching server URL for subdirectory of worktree', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj', worktree: '/Users/test/project', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project/src/components', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:3000');
    });

    test('returns matching server URL when cwd is in sandboxes', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          return { ok: true, json: async () => ({ 
            id: 'proj',
            worktree: '/Users/test/project', 
            sandboxes: ['/Users/test/.opencode/worktree/abc/sandbox-1'],
            time: { created: 1 }
          }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/.opencode/worktree/abc/sandbox-1', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:3000');
    });

    test('prefers more specific worktree match over less specific', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          // Global project
          return { ok: true, json: async () => ({ id: 'global', worktree: '/', sandboxes: [], time: { created: 1 } }) };
        }
        if (url === 'http://localhost:4000/project/current') {
          // Specific project
          return { ok: true, json: async () => ({ id: 'proj', worktree: '/Users/test/project', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project/src', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      // Should prefer the more specific match (port 4000)
      assert.strictEqual(result, 'http://localhost:4000');
    });

    test('uses global project server as fallback when no specific match', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          // Global project with worktree="/"
          return { ok: true, json: async () => ({ id: 'global', worktree: '/', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      // Global servers should be used as fallback when no project-specific match
      const result = await discoverOpencodeServer('/Users/test/random/path', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:3000');
    });

    test('returns null when fetch fails for all servers', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async () => {
        throw new Error('Connection refused');
      };
      
      const result = await discoverOpencodeServer('/some/path', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, null);
    });

    test('skips servers that return non-ok response', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          return { ok: false };
        }
        if (url === 'http://localhost:4000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj', worktree: '/Users/test/project', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:4000');
    });

    test('skips servers that return invalid JSON', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          // Stale server returning HTML
          return { 
            ok: true, 
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
          };
        }
        if (url === 'http://localhost:4000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj', worktree: '/Users/test/project', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:4000');
    });

    test('skips servers with incomplete project data (missing time)', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000, 4000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          // Server returning incomplete response (missing time.created)
          return { ok: true, json: async () => ({ id: 'broken', worktree: '/Users/test/project', sandboxes: [] }) };
        }
        if (url === 'http://localhost:4000/project/current') {
          return { ok: true, json: async () => ({ id: 'proj', worktree: '/Users/test/project', sandboxes: [], time: { created: 1 } }) };
        }
        return { ok: false };
      };
      
      const result = await discoverOpencodeServer('/Users/test/project', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, 'http://localhost:4000');
    });

    test('returns null when server returns unhealthy project data', async () => {
      const { discoverOpencodeServer } = await import('../../service/actions.js');
      
      const mockPorts = async () => [3000];
      const mockFetch = async (url) => {
        if (url === 'http://localhost:3000/project/current') {
          // Server returns incomplete/unhealthy data (missing id and time)
          return { ok: true, json: async () => ({ worktree: '/', sandboxes: [] }) };
        }
        return { ok: false };
      };
      
      // Server that returns unhealthy project data should be skipped
      const result = await discoverOpencodeServer('/Users/test/specific-project', { 
        getPorts: mockPorts,
        fetch: mockFetch
      });
      
      assert.strictEqual(result, null, 'Should return null when server returns unhealthy project data');
    });
  });

  describe('executeAction', () => {
    test('uses HTTP API when server is discovered (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default'
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer
      });
      
      assert.ok(result.dryRun);
      assert.ok(result.command.includes('POST'), 'Command should show POST request');
      assert.ok(result.command.includes('http://localhost:4096'), 'Command should include server URL');
      assert.ok(result.command.includes('directory='), 'Command should include directory param');
    });

    test('returns error when no server discovered', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default'
      };
      
      // Mock no server found
      const mockDiscoverServer = async () => null;
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer
      });
      
      assert.strictEqual(result.success, false, 'Should fail when no server');
      assert.ok(result.error.includes('No OpenCode server'), 'Should have descriptive error');
    });

    test('skips item when no local path is configured', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'PR from unknown fork' };
      // Config with no path/working_dir - simulates unknown repo
      const config = {
        prompt: 'default'
        // Note: no path, working_dir, or repo_path - simulates unknown repo
      };
      
      const result = await executeAction(item, config, { dryRun: true });
      
      assert.strictEqual(result.success, false, 'Should fail when no path configured');
      assert.strictEqual(result.skipped, true, 'Should mark as skipped');
      assert.ok(result.error.includes('No local path configured'), 'Should have descriptive error');
    });

    test('allows any path when working_dir is explicitly set', async () => {
      const { executeAction } = await import('../../service/actions.js');
      const os = await import('os');
      
      const item = { number: 123, title: 'Global task' };
      // Explicit working_dir to home - user intentionally wants this
      const config = {
        working_dir: os.homedir(),
        prompt: 'default'
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      // Should not skip because working_dir is explicitly set
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: async () => ({ ok: false, text: async () => 'Not found' })
      });
      
      // It won't succeed (no valid session endpoint mock) but it shouldn't be skipped
      assert.notStrictEqual(result.skipped, true, 'Should NOT skip when working_dir is explicit');
    });

    test('creates new worktree when worktree: "new" is configured (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default',
        worktree: 'new',
        worktree_name: 'feature-branch'
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      // Mock worktree creation via fetch
      const mockFetch = async (url, opts) => {
        // Worktree creation endpoint - now includes directory query param
        if (url.startsWith('http://localhost:4096/experimental/worktree') && opts?.method === 'POST') {
          // Verify directory parameter is passed
          const urlObj = new URL(url);
          assert.strictEqual(urlObj.searchParams.get('directory'), tempDir, 
            'Should pass directory as query param');
          const body = JSON.parse(opts.body);
          assert.strictEqual(body.name, 'feature-branch', 'Should pass worktree name');
          return {
            ok: true,
            json: async () => ({
              name: 'feature-branch',
              branch: 'opencode/feature-branch',
              directory: '/data/worktree/proj123/feature-branch'
            })
          };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.dryRun);
      // The directory in the command should be the worktree directory
      assert.ok(result.command.includes('/data/worktree/proj123/feature-branch'), 
        'Should use worktree directory in command');
    });

    test('uses existing worktree by name (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default',
        worktree: 'my-feature'
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      // Mock worktree list lookup - now includes directory param
      const mockFetch = async (url) => {
        if (url.includes('/experimental/worktree')) {
          return {
            ok: true,
            json: async () => [
              '/data/worktree/proj123/other-branch',
              '/data/worktree/proj123/my-feature'
            ]
          };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.dryRun);
      assert.ok(result.command.includes('/data/worktree/proj123/my-feature'), 
        'Should use looked up worktree path in command');
    });

    test('falls back to base directory when worktree creation fails (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default',
        worktree: 'new'
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      // Mock worktree creation failure
      const mockFetch = async (url, opts) => {
        if (url === 'http://localhost:4096/experimental/worktree' && opts?.method === 'POST') {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal server error'
          };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.dryRun);
      // Should fall back to base directory
      assert.ok(result.command.includes(tempDir), 
        'Should fall back to base directory when worktree creation fails');
    });

    test('auto-detects worktree support when project has sandboxes (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 456, title: 'New feature' };
      const config = {
        path: tempDir,
        prompt: 'default'
        // Note: no worktree config - should be auto-detected
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      // Track API calls
      let projectListCalled = false;
      let worktreeCreateCalled = false;
      
      const mockFetch = async (url, opts) => {
        // Project list endpoint - returns projects including one with sandboxes
        if (url === 'http://localhost:4096/project') {
          projectListCalled = true;
          return {
            ok: true,
            json: async () => ([
              {
                id: 'proj-123',
                worktree: tempDir,
                sandboxes: ['/data/worktree/proj-123/sandbox-1'],
                time: { created: 1 }
              }
            ])
          };
        }
        // Worktree creation endpoint - now includes directory query param
        if (url.startsWith('http://localhost:4096/experimental/worktree') && opts?.method === 'POST') {
          worktreeCreateCalled = true;
          return {
            ok: true,
            json: async () => ({
              name: 'new-sandbox',
              branch: 'opencode/new-sandbox',
              directory: '/data/worktree/proj-123/new-sandbox'
            })
          };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.dryRun);
      assert.ok(projectListCalled, 'Should call /project to find project by directory');
      assert.ok(worktreeCreateCalled, 'Should auto-create worktree when sandboxes detected');
      assert.ok(result.command.includes('/data/worktree/proj-123/new-sandbox'), 
        'Should use newly created worktree directory');
    });

    test('does not auto-create worktree when project has no sandboxes (dry run)', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 789, title: 'Simple fix' };
      const config = {
        path: tempDir,
        prompt: 'default'
        // Note: no worktree config
      };
      
      // Mock server discovery
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      let projectListCalled = false;
      let worktreeCreateCalled = false;
      
      const mockFetch = async (url, opts) => {
        // Project list endpoint - returns project with empty sandboxes
        if (url === 'http://localhost:4096/project') {
          projectListCalled = true;
          return {
            ok: true,
            json: async () => ([
              {
                id: 'proj-456',
                worktree: tempDir,
                sandboxes: [],
                time: { created: 1 }
              }
            ])
          };
        }
        if (url === 'http://localhost:4096/experimental/worktree' && opts?.method === 'POST') {
          worktreeCreateCalled = true;
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await executeAction(item, config, { 
        dryRun: true,
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.dryRun);
      assert.ok(projectListCalled, 'Should call /project to find project by directory');
      assert.ok(!worktreeCreateCalled, 'Should NOT create worktree when no sandboxes');
      assert.ok(result.command.includes(tempDir), 
        'Should use base directory when no worktree workflow detected');
    });
  });

  describe('createSessionViaApi', () => {
    test('creates session and sends message with directory param', async () => {
      const { createSessionViaApi } = await import('../../service/actions.js');
      
      const mockSessionId = 'ses_test123';
      let createCalled = false;
      let messageCalled = false;
      let createUrl = null;
      let messageUrl = null;
      
      const mockFetch = async (url, opts) => {
        const urlObj = new URL(url);
        
        if (urlObj.pathname === '/session' && opts?.method === 'POST') {
          createCalled = true;
          createUrl = url;
          return {
            ok: true,
            json: async () => ({ id: mockSessionId }),
          };
        }
        
        if (urlObj.pathname.includes('/message') && opts?.method === 'POST') {
          messageCalled = true;
          messageUrl = url;
          return {
            ok: true,
            json: async () => ({ success: true }),
          };
        }
        
        return { ok: false, text: async () => 'Not found' };
      };
      
      const result = await createSessionViaApi(
        'http://localhost:4096',
        '/path/to/project',
        'Fix the bug',
        { fetch: mockFetch }
      );
      
      assert.ok(result.success, 'Should succeed');
      assert.strictEqual(result.sessionId, mockSessionId, 'Should return session ID');
      assert.ok(createCalled, 'Should call create session endpoint');
      assert.ok(messageCalled, 'Should call message endpoint');
      // URL encodes slashes as %2F
      assert.ok(createUrl.includes('directory='), 'Create URL should include directory param');
      assert.ok(createUrl.includes('%2Fpath%2Fto%2Fproject'), 'Create URL should include encoded directory path');
      assert.ok(messageUrl.includes('directory='), 'Message URL should include directory param');
      assert.ok(messageUrl.includes('%2Fpath%2Fto%2Fproject'), 'Message URL should include encoded directory path');
    });

    test('handles session creation failure', async () => {
      const { createSessionViaApi } = await import('../../service/actions.js');
      
      const mockFetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });
      
      const result = await createSessionViaApi(
        'http://localhost:4096',
        '/path/to/project',
        'Fix the bug',
        { fetch: mockFetch }
      );
      
      assert.ok(!result.success, 'Should fail');
      assert.ok(result.error.includes('Failed to create session'), 'Should include error message');
    });

    test('passes agent and model options', async () => {
      const { createSessionViaApi } = await import('../../service/actions.js');
      
      let messageBody = null;
      
      const mockFetch = async (url, opts) => {
        const urlObj = new URL(url);
        
        if (urlObj.pathname === '/session' && opts?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: 'ses_test' }),
          };
        }
        
        if (urlObj.pathname.includes('/message')) {
          messageBody = JSON.parse(opts.body);
          return {
            ok: true,
            json: async () => ({ success: true }),
          };
        }
        
        // PATCH for title update
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({}) };
        }
        
        return { ok: false, text: async () => 'Not found' };
      };
      
      await createSessionViaApi(
        'http://localhost:4096',
        '/path/to/project',
        'Fix the bug',
        { 
          fetch: mockFetch,
          agent: 'code',
          model: 'anthropic/claude-sonnet-4-20250514',
          title: 'Test Session',
        }
      );
      
      assert.strictEqual(messageBody.agent, 'code', 'Should pass agent');
      assert.strictEqual(messageBody.providerID, 'anthropic', 'Should parse provider from model');
      assert.strictEqual(messageBody.modelID, 'claude-sonnet-4-20250514', 'Should parse model ID');
    });

    test('returns success with warning when session created but message fails', async () => {
      const { createSessionViaApi } = await import('../../service/actions.js');
      
      const mockSessionId = 'ses_partial123';
      
      const mockFetch = async (url, opts) => {
        const urlObj = new URL(url);
        
        // Session creation succeeds
        if (urlObj.pathname === '/session' && opts?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: mockSessionId }),
          };
        }
        
        // Message send fails
        if (urlObj.pathname.includes('/message') && opts?.method === 'POST') {
          return {
            ok: false,
            status: 500,
            text: async () => 'Message send failed',
          };
        }
        
        return { ok: true, json: async () => ({}) };
      };
      
      const result = await createSessionViaApi(
        'http://localhost:4096',
        '/path/to/project',
        'Fix the bug',
        { fetch: mockFetch }
      );
      
      // Should return success because session was created
      assert.ok(result.success, 'Should return success when session was created');
      assert.strictEqual(result.sessionId, mockSessionId, 'Should return session ID');
      assert.ok(result.warning, 'Should include warning about message failure');
      assert.ok(result.warning.includes('Failed to send message'), 'Warning should mention message failure');
    });
  });

  describe('session reuse', () => {
    test('isSessionArchived returns true when time.archived is set', async () => {
      const { isSessionArchived } = await import('../../service/actions.js');
      
      // Archived session (time.archived is a timestamp)
      const archivedSession = { id: 'ses_1', time: { created: 1000, updated: 2000, archived: 3000 } };
      assert.strictEqual(isSessionArchived(archivedSession), true);
      
      // Active session (no time.archived)
      const activeSession = { id: 'ses_2', time: { created: 1000, updated: 2000 } };
      assert.strictEqual(isSessionArchived(activeSession), false);
      
      // Handle edge cases
      assert.strictEqual(isSessionArchived(null), false);
      assert.strictEqual(isSessionArchived({}), false);
      assert.strictEqual(isSessionArchived({ time: {} }), false);
    });

    test('selectBestSession prefers idle sessions', async () => {
      const { selectBestSession } = await import('../../service/actions.js');
      
      const sessions = [
        { id: 'ses_busy', time: { updated: 3000 } },
        { id: 'ses_idle', time: { updated: 2000 } },
        { id: 'ses_retry', time: { updated: 1000 } },
      ];
      
      const statuses = {
        'ses_busy': { type: 'busy' },
        'ses_retry': { type: 'retry', attempt: 1, message: 'error', next: 5000 },
        // ses_idle not in statuses = idle
      };
      
      const best = selectBestSession(sessions, statuses);
      assert.strictEqual(best.id, 'ses_idle', 'Should prefer idle session even with older updated time');
    });

    test('selectBestSession falls back to most recently updated when all busy', async () => {
      const { selectBestSession } = await import('../../service/actions.js');
      
      const sessions = [
        { id: 'ses_1', time: { updated: 1000 } },
        { id: 'ses_2', time: { updated: 3000 } },  // most recent
        { id: 'ses_3', time: { updated: 2000 } },
      ];
      
      const statuses = {
        'ses_1': { type: 'busy' },
        'ses_2': { type: 'busy' },
        'ses_3': { type: 'busy' },
      };
      
      const best = selectBestSession(sessions, statuses);
      assert.strictEqual(best.id, 'ses_2', 'Should select most recently updated when all busy');
    });

    test('selectBestSession returns null for empty array', async () => {
      const { selectBestSession } = await import('../../service/actions.js');
      
      assert.strictEqual(selectBestSession([], {}), null);
      assert.strictEqual(selectBestSession(null, {}), null);
    });

    test('listSessions fetches sessions filtered by directory', async () => {
      const { listSessions } = await import('../../service/actions.js');
      
      let calledUrl = null;
      const mockFetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          json: async () => [
            { id: 'ses_1', directory: '/path/to/project', time: { created: 1000 } },
          ],
        };
      };
      
      const sessions = await listSessions('http://localhost:4096', { 
        directory: '/path/to/project',
        fetch: mockFetch 
      });
      
      assert.ok(calledUrl.includes('directory='), 'Should include directory param');
      assert.ok(calledUrl.includes('roots=true'), 'Should only get root sessions');
      assert.strictEqual(sessions.length, 1);
    });

    test('findReusableSession filters out archived sessions', async () => {
      const { findReusableSession } = await import('../../service/actions.js');
      
      const mockFetch = async (url) => {
        if (url.includes('/session/status')) {
          return { ok: true, json: async () => ({}) };
        }
        // GET /session
        return {
          ok: true,
          json: async () => [
            { id: 'ses_archived', directory: '/path', time: { created: 1000, updated: 3000, archived: 4000 } },
            { id: 'ses_active', directory: '/path', time: { created: 2000, updated: 2500 } },
          ],
        };
      };
      
      const session = await findReusableSession('http://localhost:4096', '/path', { fetch: mockFetch });
      
      assert.ok(session, 'Should find a session');
      assert.strictEqual(session.id, 'ses_active', 'Should return the active session, not archived');
    });

    test('findReusableSession returns null when all sessions are archived', async () => {
      const { findReusableSession } = await import('../../service/actions.js');
      
      const mockFetch = async (url) => {
        if (url.includes('/session/status')) {
          return { ok: true, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => [
            { id: 'ses_1', directory: '/path', time: { created: 1000, archived: 2000 } },
            { id: 'ses_2', directory: '/path', time: { created: 1500, archived: 2500 } },
          ],
        };
      };
      
      const session = await findReusableSession('http://localhost:4096', '/path', { fetch: mockFetch });
      
      assert.strictEqual(session, null, 'Should return null when all sessions are archived');
    });

    test('executeAction reuses existing session instead of creating new', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: tempDir,
        prompt: 'default',
      };
      
      let sessionCreated = false;
      let messagePosted = false;
      let messageSessionId = null;
      
      const mockFetch = async (url, opts) => {
        // GET /session - return existing active session
        if (url.includes('/session') && !url.includes('/message') && !url.includes('/status') && (!opts || opts.method !== 'POST' && opts.method !== 'PATCH')) {
          return {
            ok: true,
            json: async () => [
              { id: 'ses_existing', directory: tempDir, time: { created: 1000, updated: 2000 } },
            ],
          };
        }
        // GET /session/status
        if (url.includes('/session/status')) {
          return { ok: true, json: async () => ({}) };  // session is idle
        }
        // POST /session (create) - should NOT be called
        if (url.endsWith('/session') && opts?.method === 'POST') {
          sessionCreated = true;
          return { ok: true, json: async () => ({ id: 'ses_new' }) };
        }
        // PATCH /session/:id (update title)
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({}) };
        }
        // POST /session/:id/message
        if (url.includes('/message') && opts?.method === 'POST') {
          messagePosted = true;
          messageSessionId = url.match(/session\/([^/]+)\/message/)?.[1];
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      const result = await executeAction(item, config, { 
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.success, 'Should succeed');
      assert.strictEqual(result.sessionId, 'ses_existing', 'Should use existing session ID');
      assert.strictEqual(result.sessionReused, true, 'Should indicate session was reused');
      assert.strictEqual(sessionCreated, false, 'Should NOT create a new session');
      assert.strictEqual(messagePosted, true, 'Should post message to existing session');
      assert.strictEqual(messageSessionId, 'ses_existing', 'Should post to the existing session');
    });

    test('executeAction creates new session when existing is archived', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 456, title: 'New feature' };
      const config = {
        path: tempDir,
        prompt: 'default',
      };
      
      let sessionCreated = false;
      
      const mockFetch = async (url, opts) => {
        // GET /session - return only archived session
        if (url.includes('/session') && !url.includes('/message') && !url.includes('/status') && (!opts || opts.method !== 'POST' && opts.method !== 'PATCH')) {
          return {
            ok: true,
            json: async () => [
              { id: 'ses_archived', directory: tempDir, time: { created: 1000, updated: 2000, archived: 3000 } },
            ],
          };
        }
        // GET /session/status
        if (url.includes('/session/status')) {
          return { ok: true, json: async () => ({}) };
        }
        // POST /session (create) - should be called since archived session can't be reused
        if (url.includes('/session') && !url.includes('/message') && opts?.method === 'POST') {
          sessionCreated = true;
          return { ok: true, json: async () => ({ id: 'ses_new' }) };
        }
        // PATCH /session/:id
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({}) };
        }
        // POST /session/:id/message
        if (url.includes('/message') && opts?.method === 'POST') {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      const result = await executeAction(item, config, { 
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.success, 'Should succeed');
      assert.strictEqual(result.sessionId, 'ses_new', 'Should create new session');
      assert.strictEqual(result.sessionReused, undefined, 'Should NOT indicate session was reused');
      assert.strictEqual(sessionCreated, true, 'Should create a new session when existing is archived');
    });

    test('executeAction skips session reuse when reuse_active_session is false', async () => {
      const { executeAction } = await import('../../service/actions.js');
      
      const item = { number: 789, title: 'Forced new' };
      const config = {
        path: tempDir,
        prompt: 'default',
        reuse_active_session: false,  // disable reuse
      };
      
      let sessionListCalled = false;
      let sessionCreated = false;
      
      const mockFetch = async (url, opts) => {
        // GET /session - should NOT be called
        if (url.includes('/session') && !url.includes('/message') && !url.includes('/status') && (!opts || opts.method !== 'POST' && opts.method !== 'PATCH')) {
          sessionListCalled = true;
          return { ok: true, json: async () => [] };
        }
        // POST /session
        if (url.includes('/session') && !url.includes('/message') && opts?.method === 'POST') {
          sessionCreated = true;
          return { ok: true, json: async () => ({ id: 'ses_forced_new' }) };
        }
        // PATCH
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({}) };
        }
        // POST message
        if (url.includes('/message') && opts?.method === 'POST') {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: false, text: async () => 'Not found' };
      };
      
      const mockDiscoverServer = async () => 'http://localhost:4096';
      
      const result = await executeAction(item, config, { 
        discoverServer: mockDiscoverServer,
        fetch: mockFetch
      });
      
      assert.ok(result.success, 'Should succeed');
      assert.strictEqual(sessionListCalled, false, 'Should NOT list sessions when reuse disabled');
      assert.strictEqual(sessionCreated, true, 'Should create new session directly');
    });
  });
});
