/**
 * Tests for plugin/index.js - Auto-start plugin for OpenCode
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert";

describe("plugin/index.js", () => {
  describe("exports", () => {
    it("exports PilotPlugin as named export", async () => {
      const plugin = await import("../../plugin/index.js");
      assert.strictEqual(typeof plugin.PilotPlugin, "function");
    });

    it("exports PilotPlugin as default export", async () => {
      const plugin = await import("../../plugin/index.js");
      assert.strictEqual(plugin.default, plugin.PilotPlugin);
    });
  });

  describe("PilotPlugin", () => {
    it("returns empty hooks object", async () => {
      const plugin = await import("../../plugin/index.js");
      
      // Mock context with $ shell function
      const mockShell = mock.fn(() => Promise.resolve());
      mockShell.quiet = mock.fn(() => Promise.resolve());
      const ctx = { $: mockShell };
      
      // Call plugin - it will try to fetch health endpoint which will fail
      // in test environment, so it will try to start daemon
      const hooks = await plugin.PilotPlugin(ctx);
      
      // Should return empty hooks object (no event handlers)
      assert.deepStrictEqual(hooks, {});
    });

    it("is an async function", async () => {
      const plugin = await import("../../plugin/index.js");
      assert.strictEqual(
        plugin.PilotPlugin.constructor.name,
        "AsyncFunction"
      );
    });
  });
});
