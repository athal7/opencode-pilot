/**
 * Tests for actions.js - session creation with new config format and identity injection
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { buildEnvForAction } from "../../service/actions.js";
import { loadRepoConfig, clearConfigCache } from "../../service/repo-config.js";
import { clearTokenCache } from "../../service/github-app.js";

describe('actions.js', () => {
  let tempDir;
  let templatesDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-actions-test-'));
    templatesDir = join(tempDir, 'templates');
    mkdirSync(templatesDir);
    clearConfigCache();
    clearTokenCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearConfigCache();
    clearTokenCache();
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
  });

  describe("buildEnvForAction", () => {
    test("sets OPENCODE_SESSION_TYPE for autonomous sessions", async () => {
      loadRepoConfig({
        repos: {
          "myorg/backend": {},
        },
      });

      const env = await buildEnvForAction("myorg/backend", "autonomous");
      assert.strictEqual(env.OPENCODE_SESSION_TYPE, "autonomous");
    });

    test("sets OPENCODE_SESSION_TYPE for interactive sessions", async () => {
      loadRepoConfig({
        repos: {
          "myorg/backend": {},
        },
      });

      const env = await buildEnvForAction("myorg/backend", "interactive");
      assert.strictEqual(env.OPENCODE_SESSION_TYPE, "interactive");
    });

    test("does not inject identity for interactive sessions with bot policy", async () => {
      loadRepoConfig({
        identity: {
          bot: {
            github_app_id: "123",
            github_app_installation_id: "456",
            github_app_private_key: "key",
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

      const env = await buildEnvForAction("myorg/backend", "interactive");

      // Should NOT have bot identity (user policy for interactive)
      assert.strictEqual(env.GH_TOKEN, undefined);
      assert.strictEqual(env.GIT_AUTHOR_NAME, undefined);
      assert.strictEqual(env.OPENCODE_SESSION_TYPE, "interactive");
    });

    test("does not inject identity when no config", async () => {
      loadRepoConfig({
        repos: {
          "myorg/backend": {},
        },
      });

      const env = await buildEnvForAction("myorg/backend", "autonomous");

      assert.strictEqual(env.GH_TOKEN, undefined);
      assert.strictEqual(env.GIT_AUTHOR_NAME, undefined);
      assert.strictEqual(env.OPENCODE_SESSION_TYPE, "autonomous");
    });

    test("does not inject identity when bot config incomplete", async () => {
      loadRepoConfig({
        identity: {
          bot: {
            // Missing required GitHub App fields
            github_app_id: "123",
          },
          policy: {
            autonomous: "bot",
          },
        },
        repos: {
          "myorg/backend": {},
        },
      });

      const env = await buildEnvForAction("myorg/backend", "autonomous");

      // Incomplete GitHub App config should not inject identity
      assert.strictEqual(env.GH_TOKEN, undefined);
      assert.strictEqual(env.GIT_AUTHOR_NAME, undefined);
    });

    test("handles token fetch errors gracefully (falls back to no identity)", async () => {
      loadRepoConfig({
        identity: {
          bot: {
            github_app_id: "123",
            github_app_installation_id: "456",
            // Invalid key will cause token fetch to fail
            github_app_private_key_path: "/nonexistent/path/to/key.pem",
          },
          policy: {
            autonomous: "bot",
          },
        },
        repos: {
          "myorg/backend": {},
        },
      });

      // Should not throw - should fall back to no identity
      const env = await buildEnvForAction("myorg/backend", "autonomous");

      // Falls back to no identity on error
      assert.strictEqual(env.GH_TOKEN, undefined);
      assert.strictEqual(env.GIT_AUTHOR_NAME, undefined);
      assert.strictEqual(env.OPENCODE_SESSION_TYPE, "autonomous");
    });
  });
});
