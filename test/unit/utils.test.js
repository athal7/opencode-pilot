/**
 * Tests for utils.js - Shared utility functions
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('utils.js', () => {
  describe('isBot', () => {
    test('detects GitHub bot usernames with [bot] suffix', async () => {
      const { isBot } = await import('../../service/utils.js');
      
      assert.strictEqual(isBot('github-actions[bot]'), true);
      assert.strictEqual(isBot('dependabot[bot]'), true);
      assert.strictEqual(isBot('renovate[bot]'), true);
      assert.strictEqual(isBot('codecov[bot]'), true);
    });

    test('detects bots by type field', async () => {
      const { isBot } = await import('../../service/utils.js');
      
      // When user object has type: "Bot"
      assert.strictEqual(isBot('some-user', 'Bot'), true);
      assert.strictEqual(isBot('another-user', 'bot'), true);
    });

    test('returns false for regular users', async () => {
      const { isBot } = await import('../../service/utils.js');
      
      assert.strictEqual(isBot('athal7'), false);
      assert.strictEqual(isBot('octocat'), false);
      assert.strictEqual(isBot('some-developer'), false);
    });

    test('returns false for regular users with type User', async () => {
      const { isBot } = await import('../../service/utils.js');
      
      assert.strictEqual(isBot('athal7', 'User'), false);
      assert.strictEqual(isBot('octocat', 'user'), false);
    });

    test('handles edge cases', async () => {
      const { isBot } = await import('../../service/utils.js');
      
      assert.strictEqual(isBot(''), false);
      assert.strictEqual(isBot(null), false);
      assert.strictEqual(isBot(undefined), false);
    });
  });

  describe('hasNonBotFeedback', () => {
    test('returns true when there are non-bot, non-author comments', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'reviewer', type: 'User' }, body: 'Please fix the bug' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), true);
    });

    test('returns false when all comments are from bots', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'codecov[bot]', type: 'Bot' }, body: 'Coverage report' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), false);
    });

    test('returns false when only author has commented', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'athal7', type: 'User' }, body: 'Added screenshots' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), false);
    });

    test('returns false for empty comments array', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      assert.strictEqual(hasNonBotFeedback([], 'athal7'), false);
      assert.strictEqual(hasNonBotFeedback(null, 'athal7'), false);
      assert.strictEqual(hasNonBotFeedback(undefined, 'athal7'), false);
    });

    test('handles nested user object with login and type', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      const comments = [
        { user: { login: 'dependabot[bot]', type: 'Bot' }, body: 'Bump lodash' },
        { user: { login: 'maintainer', type: 'User' }, body: 'LGTM' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'contributor'), true);
    });
  });

  describe('getNestedValue', () => {
    test('gets top-level value', async () => {
      const { getNestedValue } = await import('../../service/utils.js');
      
      const obj = { name: 'Test', count: 42 };
      
      assert.strictEqual(getNestedValue(obj, 'name'), 'Test');
      assert.strictEqual(getNestedValue(obj, 'count'), 42);
    });

    test('gets nested value with dot notation', async () => {
      const { getNestedValue } = await import('../../service/utils.js');
      
      const obj = {
        repository: {
          full_name: 'myorg/backend',
          owner: { login: 'myorg' }
        }
      };
      
      assert.strictEqual(getNestedValue(obj, 'repository.full_name'), 'myorg/backend');
      assert.strictEqual(getNestedValue(obj, 'repository.owner.login'), 'myorg');
    });

    test('returns undefined for missing path', async () => {
      const { getNestedValue } = await import('../../service/utils.js');
      
      const obj = { name: 'Test' };
      
      assert.strictEqual(getNestedValue(obj, 'missing'), undefined);
      assert.strictEqual(getNestedValue(obj, 'deep.missing.path'), undefined);
    });

    test('handles null/undefined in path', async () => {
      const { getNestedValue } = await import('../../service/utils.js');
      
      const obj = { name: null, empty: { inner: undefined } };
      
      assert.strictEqual(getNestedValue(obj, 'name'), null);
      assert.strictEqual(getNestedValue(obj, 'name.anything'), undefined);
      assert.strictEqual(getNestedValue(obj, 'empty.inner'), undefined);
      assert.strictEqual(getNestedValue(obj, 'empty.inner.deep'), undefined);
    });
  });
});
