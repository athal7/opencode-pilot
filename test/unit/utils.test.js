/**
 * Tests for utils.js - Shared utility functions
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('utils.js', () => {
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
