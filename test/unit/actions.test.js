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

  describe('getCommandInfoNew', () => {
    test('builds command with all options', async () => {
      writeFileSync(join(templatesDir, 'default.md'), '{title}\n\n{body}');
      
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug', body: 'Details' };
      const config = {
        path: '~/code/backend',
        prompt: 'default',
        agent: 'coder',
        session: { name: 'issue-{number}' }
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      assert.strictEqual(cmdInfo.cwd, join(homedir(), 'code/backend'));
      assert.ok(cmdInfo.args.includes('opencode'));
      assert.ok(cmdInfo.args.includes('run'));
      assert.ok(cmdInfo.args.includes('--title'));
      assert.ok(cmdInfo.args.includes('issue-123'));
      assert.ok(cmdInfo.args.includes('--agent'));
      assert.ok(cmdInfo.args.includes('coder'));
    });

    test('uses working_dir when no path', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { id: 'reminder-1', title: 'Do something' };
      const config = {
        working_dir: '~/scratch',
        prompt: 'default'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      assert.strictEqual(cmdInfo.cwd, join(homedir(), 'scratch'));
    });

    test('defaults to home dir when no path or working_dir', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { title: 'Do something' };
      const config = { prompt: 'default' };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      assert.strictEqual(cmdInfo.cwd, homedir());
    });

    test('includes prompt from template as message', async () => {
      writeFileSync(join(templatesDir, 'devcontainer.md'), '/devcontainer issue-{number}\n\n{title}\n\n{body}');
      
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { number: 66, title: 'Fix bug', body: 'Details' };
      const config = {
        path: '~/code/backend',
        prompt: 'devcontainer'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      // Should NOT have --command flag (slash command is in template)
      assert.ok(!cmdInfo.args.includes('--command'), 'Should not include --command flag');
      
      // Prompt should include the /devcontainer command
      const lastArg = cmdInfo.args[cmdInfo.args.length - 1];
      assert.ok(lastArg.includes('/devcontainer issue-66'), 'Prompt should include /devcontainer command');
      assert.ok(lastArg.includes('Fix bug'), 'Prompt should include title');
    });

    test('includes --attach when serverUrl is provided', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: '~/code/backend',
        prompt: 'default'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir, 'http://localhost:4096');
      
      assert.ok(cmdInfo.args.includes('--attach'), 'Should include --attach flag');
      assert.ok(cmdInfo.args.includes('http://localhost:4096'), 'Should include server URL');
    });

    test('does not include --attach when serverUrl is null', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { number: 123, title: 'Fix bug' };
      const config = {
        path: '~/code/backend',
        prompt: 'default'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir, null);
      
      assert.ok(!cmdInfo.args.includes('--attach'), 'Should not include --attach flag');
    });

    test('uses item title as session name when no session.name configured', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { id: 'reminder-123', title: 'Review quarterly reports' };
      const config = {
        path: '~/code/backend',
        prompt: 'default'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      const titleIndex = cmdInfo.args.indexOf('--title');
      assert.ok(titleIndex !== -1, 'Should have --title flag');
      assert.strictEqual(cmdInfo.args[titleIndex + 1], 'Review quarterly reports', 'Should use item title as session name');
    });

    test('falls back to timestamp when no session.name and no title', async () => {
      const { getCommandInfoNew } = await import('../../service/actions.js');
      
      const item = { id: 'item-123' };
      const config = {
        path: '~/code/backend',
        prompt: 'default'
      };
      
      const cmdInfo = getCommandInfoNew(item, config, templatesDir);
      
      const titleIndex = cmdInfo.args.indexOf('--title');
      assert.ok(titleIndex !== -1, 'Should have --title flag');
      assert.ok(cmdInfo.args[titleIndex + 1].startsWith('session-'), 'Should fall back to session-{timestamp}');
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
      assert.strictEqual(result.method, 'api', 'Should use API method when server found');
      assert.ok(result.command.includes('POST'), 'Command should show POST request');
      assert.ok(result.command.includes('http://localhost:4096'), 'Command should include server URL');
      assert.ok(result.command.includes('directory='), 'Command should include directory param');
    });

    test('falls back to spawn when no server discovered (dry run)', async () => {
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
      
      assert.ok(result.dryRun);
      assert.strictEqual(result.method, 'spawn', 'Should use spawn method when no server');
      assert.ok(!result.command.includes('--attach'), 'Command should not include --attach flag');
      assert.ok(result.command.includes('opencode run'), 'Command should include opencode run');
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
  });
});
