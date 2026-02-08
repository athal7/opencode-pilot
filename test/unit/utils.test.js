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

    test('returns false when only author has top-level comments', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // Top-level comments from author (no state, no path) are ignored
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'athal7', type: 'User' }, body: 'Added screenshots' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), false);
    });

    test('returns true when author has submitted a PR review (self-review)', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // PR reviews from author (have state field) ARE actionable - self-review feedback
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'athal7', type: 'User' }, state: 'COMMENTED', body: 'TODO: add tests' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), true);
    });

    test('returns true when author has standalone inline comment', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // Standalone inline comments from author (have path, no in_reply_to_id) ARE actionable
      const comments = [
        { 
          user: { login: 'athal7', type: 'User' }, 
          body: 'Need to refactor this', 
          path: 'src/index.js',
          diff_hunk: '@@ -1,3 +1,4 @@',
        },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), true);
    });

    test('returns false when author has reply inline comment', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // Reply inline comments from author (have in_reply_to_id) are ignored
      const comments = [
        { 
          user: { login: 'athal7', type: 'User' }, 
          body: 'Fixed!', 
          path: 'src/index.js',
          diff_hunk: '@@ -1,3 +1,4 @@',
          in_reply_to_id: 12345,
        },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'athal7'), false);
    });

    test('returns false when author self-approves with no feedback', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // Author's approval-only (no body) should not trigger
      const comments = [
        { user: { login: 'athal7', type: 'User' }, state: 'APPROVED', body: '' },
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

    test('returns false when only approval-only reviews (no feedback body)', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // PR reviews with APPROVED state but no body should not trigger feedback
      const comments = [
        { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
        { user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', body: '' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'author'), false);
    });

    test('returns true when approval includes feedback body', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      // If someone approves but leaves feedback, we should consider it actionable
      const comments = [
        { user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', body: 'LGTM but consider adding a test for edge cases' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'author'), true);
    });

    test('returns true for CHANGES_REQUESTED reviews', async () => {
      const { hasNonBotFeedback } = await import('../../service/utils.js');
      
      const comments = [
        { user: { login: 'reviewer', type: 'User' }, state: 'CHANGES_REQUESTED', body: 'Please fix this' },
      ];
      
      assert.strictEqual(hasNonBotFeedback(comments, 'author'), true);
    });
  });

  describe('isApprovalOnly', () => {
    test('returns true for APPROVED state with no body', async () => {
      const { isApprovalOnly } = await import('../../service/utils.js');
      
      assert.strictEqual(isApprovalOnly({ state: 'APPROVED' }), true);
      assert.strictEqual(isApprovalOnly({ state: 'APPROVED', body: '' }), true);
      assert.strictEqual(isApprovalOnly({ state: 'APPROVED', body: null }), true);
    });

    test('returns false for APPROVED with substantive body', async () => {
      const { isApprovalOnly } = await import('../../service/utils.js');
      
      // If someone approves but leaves feedback, we should still consider it feedback
      assert.strictEqual(isApprovalOnly({ state: 'APPROVED', body: 'LGTM but consider renaming this function' }), false);
    });

    test('returns false for CHANGES_REQUESTED', async () => {
      const { isApprovalOnly } = await import('../../service/utils.js');
      
      assert.strictEqual(isApprovalOnly({ state: 'CHANGES_REQUESTED', body: 'Please fix this' }), false);
      assert.strictEqual(isApprovalOnly({ state: 'CHANGES_REQUESTED' }), false);
    });

    test('returns false for COMMENTED state', async () => {
      const { isApprovalOnly } = await import('../../service/utils.js');
      
      assert.strictEqual(isApprovalOnly({ state: 'COMMENTED', body: 'This looks good' }), false);
    });

    test('returns false for regular comments without state', async () => {
      const { isApprovalOnly } = await import('../../service/utils.js');
      
      // Issue comments don't have state field
      assert.strictEqual(isApprovalOnly({ body: 'Please address this' }), false);
      assert.strictEqual(isApprovalOnly({}), false);
    });
  });

  describe('isPrReview', () => {
    test('returns true for objects with state field', async () => {
      const { isPrReview } = await import('../../service/utils.js');
      
      assert.strictEqual(isPrReview({ state: 'APPROVED' }), true);
      assert.strictEqual(isPrReview({ state: 'CHANGES_REQUESTED' }), true);
      assert.strictEqual(isPrReview({ state: 'COMMENTED' }), true);
    });

    test('returns false for objects without state field', async () => {
      const { isPrReview } = await import('../../service/utils.js');
      
      assert.strictEqual(isPrReview({ body: 'Comment' }), false);
      assert.strictEqual(isPrReview({}), false);
      // null/undefined returns falsy (null), which is fine for boolean checks
      assert.ok(!isPrReview(null));
      assert.ok(!isPrReview(undefined));
    });
  });

  describe('isInlineComment', () => {
    test('returns true for comments with path field', async () => {
      const { isInlineComment } = await import('../../service/utils.js');
      
      assert.strictEqual(isInlineComment({ path: 'src/index.js', body: 'Fix this' }), true);
    });

    test('returns true for comments with diff_hunk field', async () => {
      const { isInlineComment } = await import('../../service/utils.js');
      
      assert.strictEqual(isInlineComment({ diff_hunk: '@@ -1,3 +1,4 @@', body: 'Nice' }), true);
    });

    test('returns false for top-level comments', async () => {
      const { isInlineComment } = await import('../../service/utils.js');
      
      assert.strictEqual(isInlineComment({ body: 'Great work!' }), false);
      assert.strictEqual(isInlineComment({}), false);
      assert.strictEqual(isInlineComment(null), false);
    });
  });

  describe('isReply', () => {
    test('returns true for comments with in_reply_to_id', async () => {
      const { isReply } = await import('../../service/utils.js');
      
      assert.strictEqual(isReply({ in_reply_to_id: 12345 }), true);
      assert.strictEqual(isReply({ in_reply_to_id: 0 }), true);
    });

    test('returns false for standalone comments', async () => {
      const { isReply } = await import('../../service/utils.js');
      
      assert.strictEqual(isReply({ body: 'Standalone' }), false);
      assert.strictEqual(isReply({ in_reply_to_id: null }), false);
      assert.strictEqual(isReply({ in_reply_to_id: undefined }), false);
      assert.strictEqual(isReply(null), false);
    });
  });

  describe('extractIssueRefs', () => {
    test('extracts Linear issue IDs from text', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      assert.deepStrictEqual(
        extractIssueRefs('Fix bug in ENG-123'),
        ['linear:ENG-123']
      );
      assert.deepStrictEqual(
        extractIssueRefs('Implement PROJ-456 feature'),
        ['linear:PROJ-456']
      );
    });

    test('extracts multiple Linear IDs', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      const refs = extractIssueRefs('Fixes ENG-123 and also addresses ENG-456');
      assert.ok(refs.includes('linear:ENG-123'));
      assert.ok(refs.includes('linear:ENG-456'));
      assert.strictEqual(refs.length, 2);
    });

    test('extracts full GitHub issue references', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      assert.deepStrictEqual(
        extractIssueRefs('Fixes myorg/backend#123'),
        ['github:myorg/backend#123']
      );
    });

    test('extracts relative GitHub issue references with context', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      const refs = extractIssueRefs('Fixes #123', { repo: 'myorg/backend' });
      assert.deepStrictEqual(refs, ['github:myorg/backend#123']);
    });

    test('ignores relative GitHub refs without context', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      // Without context.repo, relative refs like #123 cannot be resolved
      const refs = extractIssueRefs('Fixes #123');
      assert.deepStrictEqual(refs, []);
    });

    test('extracts mixed Linear and GitHub refs', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      const refs = extractIssueRefs('Fixes ENG-123 and closes myorg/backend#456');
      assert.ok(refs.includes('linear:ENG-123'));
      assert.ok(refs.includes('github:myorg/backend#456'));
      assert.strictEqual(refs.length, 2);
    });

    test('deduplicates repeated references', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      const refs = extractIssueRefs('ENG-123 mentioned again ENG-123');
      assert.deepStrictEqual(refs, ['linear:ENG-123']);
    });

    test('handles typical PR body with closing keywords', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      const prBody = `## Summary
      This PR implements the feature requested in ENG-123.
      
      Closes #456
      `;
      
      const refs = extractIssueRefs(prBody, { repo: 'myorg/backend' });
      assert.ok(refs.includes('linear:ENG-123'));
      assert.ok(refs.includes('github:myorg/backend#456'));
    });

    test('handles empty/null/undefined input', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      assert.deepStrictEqual(extractIssueRefs(''), []);
      assert.deepStrictEqual(extractIssueRefs(null), []);
      assert.deepStrictEqual(extractIssueRefs(undefined), []);
    });

    test('does not match partial patterns', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      // Should not match: lowercase, no hyphen
      assert.deepStrictEqual(extractIssueRefs('eng-123'), []); // lowercase
      assert.deepStrictEqual(extractIssueRefs('ENG123'), []); // no hyphen
      // Underscores are word characters, so \b won't match - ENG-123 inside underscores won't be extracted
      assert.deepStrictEqual(extractIssueRefs('PREFIX_ENG-123_SUFFIX'), []); // underscores prevent word boundary
      // But spaces, parentheses, etc. are fine
      assert.deepStrictEqual(extractIssueRefs('(ENG-123)'), ['linear:ENG-123']);
      assert.deepStrictEqual(extractIssueRefs('See ENG-123 for details'), ['linear:ENG-123']);
    });

    test('handles various Linear team prefixes', async () => {
      const { extractIssueRefs } = await import('../../service/utils.js');
      
      // Various real-world team prefix patterns
      assert.deepStrictEqual(extractIssueRefs('A-1'), ['linear:A-1']); // shortest
      assert.deepStrictEqual(extractIssueRefs('PLATFORM-99999'), ['linear:PLATFORM-99999']); // longer
      assert.deepStrictEqual(extractIssueRefs('DEV2-123'), ['linear:DEV2-123']); // with numbers
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
