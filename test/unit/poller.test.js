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
});
