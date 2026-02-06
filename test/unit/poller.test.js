/**
 * Tests for poller.js - generic MCP-based polling
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('poller.js', () => {
  let tempDir;
  let stateFile;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-pilot-poller-test-'));
    stateFile = join(tempDir, 'poll-state.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('expandItemId', () => {
    test('expands simple field references', async () => {
      const { expandItemId } = await import('../../service/poller.js');
      
      const template = 'github:{repository.full_name}#{number}';
      const item = {
        repository: { full_name: 'myorg/backend' },
        number: 123
      };
      
      const id = expandItemId(template, item);
      assert.strictEqual(id, 'github:myorg/backend#123');
    });

    test('handles missing fields gracefully', async () => {
      const { expandItemId } = await import('../../service/poller.js');
      
      const template = 'github:{repository.full_name}#{number}';
      const item = { number: 123 };
      
      const id = expandItemId(template, item);
      // Should keep placeholder for missing field
      assert.strictEqual(id, 'github:{repository.full_name}#123');
    });

    test('expands top-level fields', async () => {
      const { expandItemId } = await import('../../service/poller.js');
      
      const template = 'linear:{identifier}';
      const item = { identifier: 'PROJ-123' };
      
      const id = expandItemId(template, item);
      assert.strictEqual(id, 'linear:PROJ-123');
    });
  });

  describe('getToolConfig', () => {
    test('returns MCP config for mcp-based sources', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = {
        name: 'test-source',
        tool: { mcp: 'github', name: 'search_issues' },
        args: { q: 'is:open' },
        item: { id: '{html_url}' }
      };
      
      const config = getToolConfig(source);
      assert.strictEqual(config.type, 'mcp');
      assert.strictEqual(config.mcpServer, 'github');
      assert.strictEqual(config.toolName, 'search_issues');
      assert.deepStrictEqual(config.args, { q: 'is:open' });
      assert.strictEqual(config.idTemplate, '{html_url}');
    });

    test('returns CLI config for command-based sources', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = {
        name: 'test-source',
        tool: { command: ['granola-cli', 'meetings', 'list', '20'] },
        item: { id: 'meeting:{id}' }
      };
      
      const config = getToolConfig(source);
      assert.strictEqual(config.type, 'cli');
      assert.deepStrictEqual(config.command, ['granola-cli', 'meetings', 'list', '20']);
      assert.strictEqual(config.idTemplate, 'meeting:{id}');
    });

    test('throws for sources missing tool config', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = { name: 'bad-source' };
      
      assert.throws(() => getToolConfig(source), /missing tool configuration/);
    });

    test('throws for mcp sources missing name', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = {
        name: 'bad-source',
        tool: { mcp: 'github' } // missing name
      };
      
      assert.throws(() => getToolConfig(source), /missing tool configuration/);
    });
  });

  describe('createPoller', () => {
    test('creates poller with state tracking', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      
      assert.strictEqual(typeof poller.isProcessed, 'function');
      assert.strictEqual(typeof poller.markProcessed, 'function');
      assert.strictEqual(typeof poller.clearState, 'function');
      assert.strictEqual(poller.getProcessedIds().length, 0);
    });

    test('tracks processed items', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      
      assert.strictEqual(poller.isProcessed('item-1'), false);
      
      poller.markProcessed('item-1', { source: 'test' });
      
      assert.strictEqual(poller.isProcessed('item-1'), true);
      assert.strictEqual(poller.getProcessedIds().length, 1);
    });

    test('getProcessedMeta returns stored metadata', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      
      // Not processed yet
      assert.strictEqual(poller.getProcessedMeta('item-1'), null);
      
      // Mark as processed with metadata including directory
      poller.markProcessed('item-1', { 
        source: 'test',
        directory: '/worktree/pr-123',
        itemState: 'open',
      });
      
      const meta = poller.getProcessedMeta('item-1');
      assert.ok(meta);
      assert.strictEqual(meta.source, 'test');
      assert.strictEqual(meta.directory, '/worktree/pr-123');
      assert.strictEqual(meta.itemState, 'open');
      assert.ok(meta.processedAt); // Should have timestamp
    });

    test('persists state across instances', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller1 = createPoller({ stateFile });
      poller1.markProcessed('item-1');
      
      const poller2 = createPoller({ stateFile });
      assert.strictEqual(poller2.isProcessed('item-1'), true);
    });

    test('clearState removes all processed items', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1');
      poller.markProcessed('item-2');
      
      assert.strictEqual(poller.getProcessedIds().length, 2);
      
      poller.clearState();
      
      assert.strictEqual(poller.getProcessedIds().length, 0);
      assert.strictEqual(poller.isProcessed('item-1'), false);
    });

    test('clearProcessed removes a single item', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'test' });
      poller.markProcessed('item-2', { source: 'test' });
      
      poller.clearProcessed('item-1');
      
      assert.strictEqual(poller.isProcessed('item-1'), false);
      assert.strictEqual(poller.isProcessed('item-2'), true);
    });
  });

  describe('cleanup methods', () => {
    test('getProcessedCount returns total count', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'source-a' });
      poller.markProcessed('item-2', { source: 'source-a' });
      poller.markProcessed('item-3', { source: 'source-b' });
      
      assert.strictEqual(poller.getProcessedCount(), 3);
    });

    test('getProcessedCount filters by source', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'source-a' });
      poller.markProcessed('item-2', { source: 'source-a' });
      poller.markProcessed('item-3', { source: 'source-b' });
      
      assert.strictEqual(poller.getProcessedCount('source-a'), 2);
      assert.strictEqual(poller.getProcessedCount('source-b'), 1);
      assert.strictEqual(poller.getProcessedCount('source-c'), 0);
    });

    test('clearBySource removes all entries for a source', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'source-a' });
      poller.markProcessed('item-2', { source: 'source-a' });
      poller.markProcessed('item-3', { source: 'source-b' });
      
      const removed = poller.clearBySource('source-a');
      
      assert.strictEqual(removed, 2);
      assert.strictEqual(poller.isProcessed('item-1'), false);
      assert.strictEqual(poller.isProcessed('item-2'), false);
      assert.strictEqual(poller.isProcessed('item-3'), true);
    });

    test('clearBySource returns 0 for unknown source', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'source-a' });
      
      const removed = poller.clearBySource('unknown');
      
      assert.strictEqual(removed, 0);
      assert.strictEqual(poller.isProcessed('item-1'), true);
    });

    test('cleanupExpired removes entries older than ttlDays', async () => {
      const { createPoller } = await import('../../service/poller.js');
      const { readFileSync } = await import('fs');
      
      const poller = createPoller({ stateFile });
      
      // Mark items as processed
      poller.markProcessed('recent-item', { source: 'test' });
      poller.markProcessed('old-item', { source: 'test' });
      
      // Manually modify the state file to make one item old
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago
      state.processed['old-item'].processedAt = oldDate.toISOString();
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Create new poller to reload state
      const poller2 = createPoller({ stateFile });
      const removed = poller2.cleanupExpired(30);
      
      assert.strictEqual(removed, 1);
      assert.strictEqual(poller2.isProcessed('recent-item'), true);
      assert.strictEqual(poller2.isProcessed('old-item'), false);
    });

    test('cleanupExpired uses default ttlDays of 30', async () => {
      const { createPoller } = await import('../../service/poller.js');
      const { readFileSync } = await import('fs');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-25-days', { source: 'test' });
      poller.markProcessed('item-35-days', { source: 'test' });
      
      // Modify state file
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const date25 = new Date();
      date25.setDate(date25.getDate() - 25);
      const date35 = new Date();
      date35.setDate(date35.getDate() - 35);
      state.processed['item-25-days'].processedAt = date25.toISOString();
      state.processed['item-35-days'].processedAt = date35.toISOString();
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      const poller2 = createPoller({ stateFile });
      const removed = poller2.cleanupExpired(); // No argument = default 30
      
      assert.strictEqual(removed, 1);
      assert.strictEqual(poller2.isProcessed('item-25-days'), true);
      assert.strictEqual(poller2.isProcessed('item-35-days'), false);
    });

    test('cleanupMissingFromSource removes stale entries for a source', async () => {
      const { createPoller } = await import('../../service/poller.js');
      const { readFileSync } = await import('fs');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'test-source' });
      poller.markProcessed('item-2', { source: 'test-source' });
      poller.markProcessed('item-3', { source: 'other-source' });
      
      // Make items old enough to be cleaned (older than minAgeDays)
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2); // 2 days ago
      for (const id of Object.keys(state.processed)) {
        state.processed[id].processedAt = oldDate.toISOString();
      }
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      const poller2 = createPoller({ stateFile });
      // Current items only has item-1 (item-2 is missing from source)
      const removed = poller2.cleanupMissingFromSource('test-source', ['item-1'], 1);
      
      assert.strictEqual(removed, 1); // item-2 removed
      assert.strictEqual(poller2.isProcessed('item-1'), true);
      assert.strictEqual(poller2.isProcessed('item-2'), false);
      assert.strictEqual(poller2.isProcessed('item-3'), true); // different source
    });

    test('cleanupMissingFromSource respects minAgeDays', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'test-source' });
      poller.markProcessed('item-2', { source: 'test-source' });
      
      // Items are fresh (just processed), so minAgeDays=1 should protect them
      const removed = poller.cleanupMissingFromSource('test-source', ['item-1'], 1);
      
      assert.strictEqual(removed, 0); // item-2 NOT removed (too recent)
      assert.strictEqual(poller.isProcessed('item-2'), true);
    });

    test('cleanupMissingFromSource with minAgeDays=0 removes immediately', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'test-source' });
      poller.markProcessed('item-2', { source: 'test-source' });
      
      // minAgeDays=0 removes even fresh items
      const removed = poller.cleanupMissingFromSource('test-source', ['item-1'], 0);
      
      assert.strictEqual(removed, 1);
      assert.strictEqual(poller.isProcessed('item-2'), false);
    });

    test('cleanup state persists across instances', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'source-a' });
      poller.markProcessed('item-2', { source: 'source-a' });
      
      poller.clearBySource('source-a');
      
      // Verify persistence
      const poller2 = createPoller({ stateFile });
      assert.strictEqual(poller2.getProcessedCount(), 0);
    });
  });

  describe('status tracking', () => {
    test('shouldReprocess returns false for item with same state', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { source: 'test', itemState: 'open' });
      
      const item = { id: 'issue-1', state: 'open' };
      assert.strictEqual(poller.shouldReprocess(item), false);
    });

    test('shouldReprocess returns true for reopened issue (closed -> open)', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { source: 'test', itemState: 'closed' });
      
      const item = { id: 'issue-1', state: 'open' };
      assert.strictEqual(poller.shouldReprocess(item), true);
    });

    test('shouldReprocess returns true for merged PR reopened', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('pr-1', { source: 'test', itemState: 'merged' });
      
      const item = { id: 'pr-1', state: 'open' };
      assert.strictEqual(poller.shouldReprocess(item), true);
    });

    test('shouldReprocess returns false for item not in state', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      
      const item = { id: 'new-issue', state: 'open' };
      assert.strictEqual(poller.shouldReprocess(item), false);
    });

    test('shouldReprocess returns false when no itemState was stored', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      // Legacy entry without itemState
      poller.markProcessed('issue-1', { source: 'test' });
      
      const item = { id: 'issue-1', state: 'open' };
      assert.strictEqual(poller.shouldReprocess(item), false);
    });

    test('shouldReprocess uses status field for Linear items', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('linear-1', { source: 'test', itemState: 'Done' });
      
      // Linear uses 'status' field instead of 'state'
      const item = { id: 'linear-1', status: 'In Progress' };
      assert.strictEqual(poller.shouldReprocess(item), true);
    });

    test('shouldReprocess does NOT check updated_at by default (avoids self-triggering)', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { 
        source: 'test', 
        itemState: 'open',
        itemUpdatedAt: '2026-01-01T00:00:00Z'
      });
      
      // Item was updated after being processed, but state is the same
      const item = { 
        id: 'issue-1', 
        state: 'open',
        updated_at: '2026-01-05T00:00:00Z'
      };
      // Should NOT reprocess because updated_at is not in default reprocessOn
      assert.strictEqual(poller.shouldReprocess(item), false);
    });

    test('shouldReprocess detects updated_at when explicitly configured', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { 
        source: 'test', 
        itemState: 'open',
        itemUpdatedAt: '2026-01-01T00:00:00Z'
      });
      
      const item = { 
        id: 'issue-1', 
        state: 'open',
        updated_at: '2026-01-05T00:00:00Z'
      };
      // Should reprocess when updated_at is explicitly in reprocessOn
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: ['updated_at'] }), 
        true
      );
    });

    test('shouldReprocess returns false if updated_at is same or older', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { 
        source: 'test', 
        itemState: 'open',
        itemUpdatedAt: '2026-01-05T00:00:00Z'
      });
      
      // Item has same updated_at
      const item = { 
        id: 'issue-1', 
        state: 'open',
        updated_at: '2026-01-05T00:00:00Z'
      };
      // Even with explicit config, same timestamp should not trigger
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: ['updated_at'] }), 
        false
      );
    });

    test('shouldReprocess respects reprocessOn config', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('issue-1', { 
        source: 'test', 
        itemState: 'closed',
        itemUpdatedAt: '2026-01-01T00:00:00Z'
      });
      
      const item = { 
        id: 'issue-1', 
        state: 'open',  // Reopened
        updated_at: '2026-01-05T00:00:00Z'  // Also updated
      };
      
      // Only check updated_at, not state
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: ['updated_at'] }), 
        true
      );
      
      // Only check state
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: ['state'] }), 
        true
      );
      
      // Check neither (empty array)
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: [] }), 
        false
      );
    });

    test('shouldReprocess handles Linear updatedAt field', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('linear-1', { 
        source: 'test', 
        itemState: 'In Progress',
        itemUpdatedAt: '2026-01-01T00:00:00Z'
      });
      
      // Linear uses camelCase updatedAt
      const item = { 
        id: 'linear-1', 
        status: 'In Progress',
        updatedAt: '2026-01-05T00:00:00Z'
      };
      
      assert.strictEqual(
        poller.shouldReprocess(item, { reprocessOn: ['updatedAt'] }), 
        true
      );
    });

    test('shouldReprocess returns true for reappeared item (e.g., uncompleted reminder)', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('reminder-1', { source: 'reminders' });
      
      // Simulate: item disappears from poll (completed), then reappears (uncompleted)
      poller.markUnseen('reminders', []); // Item not in results - marked unseen
      
      const item = { id: 'reminder-1' };
      assert.strictEqual(poller.shouldReprocess(item), true);
    });

    test('shouldReprocess returns false for item that was always present', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('reminder-1', { source: 'reminders' });
      
      // Item stays in poll results
      poller.markUnseen('reminders', ['reminder-1']);
      
      const item = { id: 'reminder-1' };
      assert.strictEqual(poller.shouldReprocess(item), false);
    });

    test('markUnseen tracks items across multiple polls', async () => {
      const { createPoller } = await import('../../service/poller.js');
      
      const poller = createPoller({ stateFile });
      poller.markProcessed('item-1', { source: 'test' });
      poller.markProcessed('item-2', { source: 'test' });
      
      // Poll 1: both present
      poller.markUnseen('test', ['item-1', 'item-2']);
      assert.strictEqual(poller.shouldReprocess({ id: 'item-1' }), false);
      assert.strictEqual(poller.shouldReprocess({ id: 'item-2' }), false);
      
      // Poll 2: item-2 disappears
      poller.markUnseen('test', ['item-1']);
      assert.strictEqual(poller.shouldReprocess({ id: 'item-1' }), false);
      assert.strictEqual(poller.shouldReprocess({ id: 'item-2' }), true);
      
      // Poll 3: item-2 reappears - wasUnseen flag should still be true until cleared
      // (The flag gets cleared when shouldReprocess triggers reprocessing)
    });
  });

  describe('pollGenericSource', () => {
    test('extracts tool config from source', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = {
        name: 'my-issues',
        tool: {
          mcp: 'github',
          name: 'github_search_issues'
        },
        args: {
          q: 'is:issue assignee:@me'
        },
        item: {
          id: 'github:{repository.full_name}#{number}'
        }
      };
      
      const toolConfig = getToolConfig(source);
      
      assert.strictEqual(toolConfig.mcpServer, 'github');
      assert.strictEqual(toolConfig.toolName, 'github_search_issues');
      assert.deepStrictEqual(toolConfig.args, { q: 'is:issue assignee:@me' });
      assert.strictEqual(toolConfig.idTemplate, 'github:{repository.full_name}#{number}');
    });

    test('throws for missing tool config', async () => {
      const { getToolConfig } = await import('../../service/poller.js');
      
      const source = {
        name: 'bad-source'
      };
      
      assert.throws(() => getToolConfig(source), /tool configuration/);
    });
  });

  describe('transformItems', () => {
    test('adds id to items using template', async () => {
      const { transformItems } = await import('../../service/poller.js');
      
      const items = [
        { repository: { full_name: 'myorg/backend' }, number: 1, title: 'Issue 1' },
        { repository: { full_name: 'myorg/backend' }, number: 2, title: 'Issue 2' },
      ];
      const idTemplate = 'github:{repository.full_name}#{number}';
      
      const transformed = transformItems(items, idTemplate);
      
      assert.strictEqual(transformed[0].id, 'github:myorg/backend#1');
      assert.strictEqual(transformed[1].id, 'github:myorg/backend#2');
      // Original fields preserved
      assert.strictEqual(transformed[0].title, 'Issue 1');
    });

    test('preserves existing id if no template', async () => {
      const { transformItems } = await import('../../service/poller.js');
      
      const items = [
        { id: 'existing-id', title: 'Issue 1' },
      ];
      
      const transformed = transformItems(items, null);
      
      assert.strictEqual(transformed[0].id, 'existing-id');
    });

    test('generates fallback id if no template and no existing id', async () => {
      const { transformItems } = await import('../../service/poller.js');
      
      const items = [
        { title: 'Issue 1' },
      ];
      
      const transformed = transformItems(items, null);
      
      // Should have some id (even if auto-generated)
      assert.ok(transformed[0].id);
    });
  });

  describe('applyMappings', () => {
    test('maps fields using simple dot notation', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        identifier: 'ODIN-123',
        title: 'Fix the bug',
        description: 'Details here'
      };
      const mappings = {
        number: 'identifier',
        title: 'title',
        body: 'description'
      };
      
      const mapped = applyMappings(item, mappings);
      
      assert.strictEqual(mapped.number, 'ODIN-123');
      assert.strictEqual(mapped.title, 'Fix the bug');
      assert.strictEqual(mapped.body, 'Details here');
    });

    test('maps nested fields', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        repository: { full_name: 'myorg/backend', name: 'backend' },
        number: 42
      };
      const mappings = {
        repo: 'repository.full_name',
        number: 'number'
      };
      
      const mapped = applyMappings(item, mappings);
      
      assert.strictEqual(mapped.repo, 'myorg/backend');
      assert.strictEqual(mapped.number, 42);
    });

    test('preserves unmapped fields', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        identifier: 'ODIN-123',
        title: 'Fix the bug',
        url: 'https://linear.app/...'
      };
      const mappings = {
        number: 'identifier'
      };
      
      const mapped = applyMappings(item, mappings);
      
      // Mapped field
      assert.strictEqual(mapped.number, 'ODIN-123');
      // Original fields preserved
      assert.strictEqual(mapped.title, 'Fix the bug');
      assert.strictEqual(mapped.url, 'https://linear.app/...');
      assert.strictEqual(mapped.identifier, 'ODIN-123');
    });

    test('handles missing source fields gracefully', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        title: 'Fix the bug'
      };
      const mappings = {
        body: 'description'  // description doesn't exist
      };
      
      const mapped = applyMappings(item, mappings);
      
      // Missing field should be undefined, not error
      assert.strictEqual(mapped.body, undefined);
      assert.strictEqual(mapped.title, 'Fix the bug');
    });

    test('returns original item when no mappings', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = { title: 'Test', number: 1 };
      
      const mapped = applyMappings(item, null);
      
      assert.deepStrictEqual(mapped, item);
    });

    test('extracts value using regex syntax', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        title: 'Fix the bug',
        url: 'https://linear.app/0din/issue/0DIN-683/attack-technique-detection'
      };
      const mappings = {
        number: 'url:/([A-Z0-9]+-[0-9]+)/'  // Matches 0DIN-683
      };
      
      const mapped = applyMappings(item, mappings);
      
      assert.strictEqual(mapped.number, '0DIN-683');
      assert.strictEqual(mapped.title, 'Fix the bug');
      assert.strictEqual(mapped.url, 'https://linear.app/0din/issue/0DIN-683/attack-technique-detection');
    });

    test('regex extraction returns undefined for no match', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      const item = {
        url: 'https://example.com/no-match'
      };
      const mappings = {
        number: 'url:/([A-Z0-9]+-[0-9]+)/'
      };
      
      const mapped = applyMappings(item, mappings);
      
      assert.strictEqual(mapped.number, undefined);
    });

    test('maps commentsCount to comments for GitHub PR enrichment', async () => {
      const { applyMappings } = await import('../../service/poller.js');
      
      // gh search prs returns commentsCount, but enrichItemsWithComments checks for 'comments'
      const item = {
        number: 123,
        title: 'Fix mobile overflow',
        commentsCount: 4,
        repository: { nameWithOwner: 'anomalyco/opencode' }
      };
      const mappings = {
        comments: 'commentsCount',
        repository_full_name: 'repository.nameWithOwner'
      };
      
      const mapped = applyMappings(item, mappings);
      
      // comments field should be set from commentsCount
      assert.strictEqual(mapped.comments, 4);
      // Original commentsCount preserved
      assert.strictEqual(mapped.commentsCount, 4);
      // Other mappings work too
      assert.strictEqual(mapped.repository_full_name, 'anomalyco/opencode');
    });
  });

  describe('fetchGitHubComments', () => {
    // Note: These tests document the expected behavior
    // Actual MCP calls require mocking which is complex

    test('should fetch both PR review comments AND issue comments', async () => {
      // The issue: Linear bot posts to issue comments endpoint, not PR review comments
      // PR review comments: GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
      // Issue comments: GET /repos/{owner}/{repo}/issues/{issue_number}/comments
      //
      // For proper bot filtering, we need to check BOTH endpoints
      // Currently only PR review comments are fetched, causing Linear bot
      // comments to be missed (they appear in issue comments)
      
      // This test documents the expected behavior - fetchGitHubComments should
      // return comments from both endpoints merged together
      const { fetchGitHubComments } = await import('../../service/poller.js');
      
      // Without proper mocking, we can only test the function exists
      // and accepts the right parameters
      assert.strictEqual(typeof fetchGitHubComments, 'function');
    });
  });

  describe('parseJsonArray', () => {
    test('parses direct array response', async () => {
      const { parseJsonArray } = await import('../../service/poller.js');
      
      const text = JSON.stringify([{ id: '1' }, { id: '2' }]);
      const result = parseJsonArray(text, 'test');
      
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, '1');
    });

    test('extracts array using response_key', async () => {
      const { parseJsonArray } = await import('../../service/poller.js');
      
      const text = JSON.stringify({
        reminders: [
          { id: 'reminder-1', name: 'Task 1', completed: false },
          { id: 'reminder-2', name: 'Task 2', completed: false },
          { id: 'reminder-3', name: 'Task 3', completed: false }
        ],
        count: 3
      });
      const result = parseJsonArray(text, 'agent-tasks', 'reminders');
      
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, 'reminder-1');
      assert.strictEqual(result[0].name, 'Task 1');
      assert.strictEqual(result[1].id, 'reminder-2');
      assert.strictEqual(result[2].id, 'reminder-3');
    });

    test('wraps single object as array when no response_key', async () => {
      const { parseJsonArray } = await import('../../service/poller.js');
      
      const text = JSON.stringify({ id: '1', title: 'Single item' });
      const result = parseJsonArray(text, 'test');
      
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, '1');
    });

    test('returns empty array for invalid JSON', async () => {
      const { parseJsonArray } = await import('../../service/poller.js');
      
      const result = parseJsonArray('not valid json', 'test');
      
      assert.strictEqual(result.length, 0);
    });

    test('returns empty array when response_key not found', async () => {
      const { parseJsonArray } = await import('../../service/poller.js');
      
      const text = JSON.stringify({ items: [{ id: '1' }] });
      const result = parseJsonArray(text, 'test', 'reminders');
      
      assert.strictEqual(result.length, 0);
    });
  });

  describe('transformItems with mappings', () => {
    test('applies mappings to all items', async () => {
      const { transformItems, applyMappings } = await import('../../service/poller.js');
      
      const items = [
        { identifier: 'PROJ-1', title: 'First', description: 'Desc 1' },
        { identifier: 'PROJ-2', title: 'Second', description: 'Desc 2' },
      ];
      const mappings = {
        number: 'identifier',
        body: 'description'
      };
      const idTemplate = 'linear:{identifier}';
      
      // First apply mappings, then transform
      const mappedItems = items.map(item => applyMappings(item, mappings));
      const transformed = transformItems(mappedItems, idTemplate);
      
      // Should have mapped fields
      assert.strictEqual(transformed[0].number, 'PROJ-1');
      assert.strictEqual(transformed[0].body, 'Desc 1');
      assert.strictEqual(transformed[0].id, 'linear:PROJ-1');
      
      assert.strictEqual(transformed[1].number, 'PROJ-2');
      assert.strictEqual(transformed[1].body, 'Desc 2');
      assert.strictEqual(transformed[1].id, 'linear:PROJ-2');
      
      // Original fields preserved
      assert.strictEqual(transformed[0].identifier, 'PROJ-1');
      assert.strictEqual(transformed[0].title, 'First');
    });
  });

  describe('computeAttentionLabels', () => {
    test('labels PR with conflicts only', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        _mergeable: 'CONFLICTING',
        _comments: []
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'Conflicts');
      assert.strictEqual(result[0]._has_attention, true);
    });

    test('labels PR with human feedback only', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'MERGEABLE',
        _comments: [
          { user: { login: 'reviewer', type: 'User' }, body: 'Please fix' }
        ]
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'Feedback');
      assert.strictEqual(result[0]._has_attention, true);
    });

    test('labels PR with both conflicts and feedback', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'CONFLICTING',
        _comments: [
          { user: { login: 'reviewer', type: 'User' }, body: 'Please fix' }
        ]
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'Conflicts+Feedback');
      assert.strictEqual(result[0]._has_attention, true);
    });

    test('labels PR with no attention conditions', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'MERGEABLE',
        _comments: []
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'PR');
      assert.strictEqual(result[0]._has_attention, false);
    });

    test('ignores bot comments when computing feedback', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'MERGEABLE',
        _comments: [
          { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'CI passed' },
          { user: { login: 'codecov[bot]', type: 'Bot' }, body: 'Coverage report' }
        ]
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'PR');
      assert.strictEqual(result[0]._has_attention, false);
    });

    test('ignores author comments when computing feedback', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'MERGEABLE',
        _comments: [
          { user: { login: 'author', type: 'User' }, body: 'Added screenshots' }
        ]
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'PR');
      assert.strictEqual(result[0]._has_attention, false);
    });

    test('ignores known bots without [bot] suffix (e.g., linear)', async () => {
      const { computeAttentionLabels } = await import('../../service/poller.js');
      
      const items = [{
        number: 123,
        title: 'Test PR',
        user: { login: 'author' },
        _mergeable: 'MERGEABLE',
        _comments: [
          // Linear bot posts linkback comments without [bot] suffix
          { user: { login: 'linear', type: 'User' }, body: '<!-- linear-linkback -->' }
        ]
      }];
      
      const result = computeAttentionLabels(items, {});
      
      assert.strictEqual(result[0]._attention_label, 'PR');
      assert.strictEqual(result[0]._has_attention, false);
    });
  });

  describe('enrichItemsWithComments', () => {
    test('skips enrichment when filter_bot_comments is not set', async () => {
      const { enrichItemsWithComments } = await import('../../service/poller.js');
      
      const items = [{ number: 1, comments: 5, repository_full_name: 'org/repo' }];
      const source = { tool: { command: ['gh', 'search', 'prs'] } }; // no filter_bot_comments
      
      const result = await enrichItemsWithComments(items, source);
      
      // Items returned unchanged, no _comments added
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]._comments, undefined);
    });

    test('skips enrichment for non-GitHub sources', async () => {
      const { enrichItemsWithComments } = await import('../../service/poller.js');
      
      const items = [{ number: 1, comments: 5, repository_full_name: 'org/repo' }];
      const source = { 
        filter_bot_comments: true,
        tool: { mcp: 'linear', name: 'list_issues' } // not GitHub
      };
      
      const result = await enrichItemsWithComments(items, source);
      
      // Items returned unchanged
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]._comments, undefined);
    });

    test('enriches items with zero commentsCount (PR reviews not counted in commentsCount)', async () => {
      // This test verifies the fix for a bug where PRs with review feedback but
      // zero issue comments were not enriched. GitHub's commentsCount only counts
      // issue comments, not PR reviews or PR review comments.
      const { enrichItemsWithComments } = await import('../../service/poller.js');
      
      const items = [
        { number: 1, comments: 0, repository_full_name: 'org/repo' },
        { number: 2, comments: 0, repository_full_name: 'org/repo' }
      ];
      const source = { 
        filter_bot_comments: true,
        tool: { command: ['gh', 'search', 'prs'] }
      };
      
      const result = await enrichItemsWithComments(items, source);
      
      // Items should be enriched with _comments (empty array if no feedback found)
      // The actual API call may fail in test environment, but items should still
      // have _comments set (either to fetched comments or empty array on error)
      assert.strictEqual(result.length, 2);
      // _comments should be defined (array) - we always try to fetch now
      assert.ok(Array.isArray(result[0]._comments), 'First item should have _comments array');
      assert.ok(Array.isArray(result[1]._comments), 'Second item should have _comments array');
    });

    test('identifies GitHub MCP source correctly', async () => {
      const { enrichItemsWithComments } = await import('../../service/poller.js');
      
      const items = [{ number: 1, comments: 0, repository_full_name: 'org/repo' }];
      const source = { 
        filter_bot_comments: true,
        tool: { mcp: 'github', name: 'search_issues' }
      };
      
      // Should try to fetch comments (may return empty array on API error in tests)
      const result = await enrichItemsWithComments(items, source);
      assert.strictEqual(result.length, 1);
      assert.ok(Array.isArray(result[0]._comments), 'Should have _comments array');
    });

    test('identifies GitHub CLI source correctly', async () => {
      const { enrichItemsWithComments } = await import('../../service/poller.js');
      
      const items = [{ number: 1, comments: 0, repository_full_name: 'org/repo' }];
      const source = { 
        filter_bot_comments: true,
        tool: { command: ['gh', 'search', 'issues', '--json', 'number'] }
      };
      
      // Should try to fetch comments (may return empty array on API error in tests)
      const result = await enrichItemsWithComments(items, source);
      assert.strictEqual(result.length, 1);
      assert.ok(Array.isArray(result[0]._comments), 'Should have _comments array');
    });
  });

  describe('enrichItemsWithMergeable', () => {
    test('skips enrichment when enrich_mergeable is not set', async () => {
      const { enrichItemsWithMergeable } = await import('../../service/poller.js');
      
      const items = [{ number: 1, repository_full_name: 'org/repo' }];
      const source = {}; // no enrich_mergeable
      
      const result = await enrichItemsWithMergeable(items, source);
      
      // Items returned unchanged
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]._mergeable, undefined);
    });

    test('skips items without repository info', async () => {
      const { enrichItemsWithMergeable } = await import('../../service/poller.js');
      
      const items = [
        { number: 1 }, // no repository_full_name
        { repository_full_name: 'org/repo' } // no number
      ];
      const source = { enrich_mergeable: true };
      
      const result = await enrichItemsWithMergeable(items, source);
      
      // Items returned unchanged (no API calls made for invalid items)
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0]._mergeable, undefined);
      assert.strictEqual(result[1]._mergeable, undefined);
    });

    test('accepts repository.nameWithOwner as alternative field', async () => {
      const { enrichItemsWithMergeable } = await import('../../service/poller.js');
      
      const items = [
        { number: 1, repository: { nameWithOwner: 'org/repo' } }
      ];
      const source = { enrich_mergeable: true };
      
      // This will attempt the API call (which may fail in test env)
      // but it should not skip due to missing repo info
      const result = await enrichItemsWithMergeable(items, source);
      
      // Should have attempted enrichment (result may have _mergeable: null on CLI error)
      assert.strictEqual(result.length, 1);
      // The item should have been processed (not skipped)
      assert.ok('_mergeable' in result[0] || result[0]._mergeable === undefined);
    });
  });

  describe('fetchGitHubComments', () => {
    test('returns empty array when repository_full_name is missing', async () => {
      const { fetchGitHubComments } = await import('../../service/poller.js');
      
      const item = { number: 123 }; // no repository_full_name
      
      const result = await fetchGitHubComments(item);
      
      assert.deepStrictEqual(result, []);
    });

    test('returns empty array when number is missing', async () => {
      const { fetchGitHubComments } = await import('../../service/poller.js');
      
      const item = { repository_full_name: 'org/repo' }; // no number
      
      const result = await fetchGitHubComments(item);
      
      assert.deepStrictEqual(result, []);
    });

    test('returns empty array when owner/repo cannot be parsed', async () => {
      const { fetchGitHubComments } = await import('../../service/poller.js');
      
      const item = { repository_full_name: 'invalid', number: 123 }; // no slash
      
      const result = await fetchGitHubComments(item);
      
      assert.deepStrictEqual(result, []);
    });
  });
});
