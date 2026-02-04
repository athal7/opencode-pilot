import { describe, it, mock } from "node:test";
import assert from "node:assert";
import {
  listWorktrees,
  createWorktree,
  getProjectInfo,
  resolveWorktreeDirectory,
} from "../../service/worktree.js";

describe("worktree", () => {
  describe("listWorktrees", () => {
    it("returns worktrees from server", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ["/path/to/worktree1", "/path/to/worktree2"],
      }));

      const result = await listWorktrees("http://localhost:4096", { fetch: mockFetch });

      assert.deepStrictEqual(result, ["/path/to/worktree1", "/path/to/worktree2"]);
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      assert.strictEqual(mockFetch.mock.calls[0].arguments[0], "http://localhost:4096/experimental/worktree");
    });

    it("passes directory parameter when provided", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ["/path/to/worktree"],
      }));

      await listWorktrees("http://localhost:4096", { 
        fetch: mockFetch,
        directory: "/path/to/project"
      });

      const calledUrl = mockFetch.mock.calls[0].arguments[0];
      assert.ok(calledUrl.includes("directory="), "Should include directory param");
      assert.ok(calledUrl.includes(encodeURIComponent("/path/to/project")), "Should encode directory path");
    });

    it("returns empty array on error", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: false,
        status: 500,
      }));

      const result = await listWorktrees("http://localhost:4096", { fetch: mockFetch });

      assert.deepStrictEqual(result, []);
    });

    it("returns empty array on network error", async () => {
      const mockFetch = mock.fn(async () => {
        throw new Error("Network error");
      });

      const result = await listWorktrees("http://localhost:4096", { fetch: mockFetch });

      assert.deepStrictEqual(result, []);
    });
  });

  describe("createWorktree", () => {
    it("creates a worktree successfully", async () => {
      const worktreeResponse = {
        name: "brave-falcon",
        branch: "opencode/brave-falcon",
        directory: "/data/worktree/abc123/brave-falcon",
      };

      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => worktreeResponse,
      }));

      const result = await createWorktree("http://localhost:4096", { fetch: mockFetch });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.worktree, worktreeResponse);
    });

    it("passes name option to server", async () => {
      const mockFetch = mock.fn(async (url, options) => ({
        ok: true,
        json: async () => ({
          name: "my-feature",
          branch: "opencode/my-feature",
          directory: "/data/worktree/abc123/my-feature",
        }),
      }));

      await createWorktree("http://localhost:4096", {
        name: "my-feature",
        fetch: mockFetch,
      });

      const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
      assert.strictEqual(body.name, "my-feature");
    });

    it("passes directory as query parameter", async () => {
      const mockFetch = mock.fn(async (url, options) => ({
        ok: true,
        json: async () => ({
          name: "test-worktree",
          branch: "opencode/test-worktree",
          directory: "/data/worktree/abc123/test-worktree",
        }),
      }));

      await createWorktree("http://localhost:4096", {
        directory: "/Users/test/code/my-project",
        fetch: mockFetch,
      });

      const calledUrl = mockFetch.mock.calls[0].arguments[0];
      assert.ok(calledUrl.includes("directory="), "URL should include directory parameter");
      assert.ok(calledUrl.includes(encodeURIComponent("/Users/test/code/my-project")), "URL should include encoded directory path");
    });

    it("returns error on failure", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "Invalid request",
      }));

      const result = await createWorktree("http://localhost:4096", { fetch: mockFetch });

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("400"));
    });
  });

  describe("getProjectInfo", () => {
    it("returns project info", async () => {
      const projectInfo = {
        id: "abc123",
        worktree: "/path/to/project",
        sandboxes: ["/path/to/sandbox1", "/path/to/sandbox2"],
      };

      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => projectInfo,
      }));

      const result = await getProjectInfo("http://localhost:4096", { fetch: mockFetch });

      assert.deepStrictEqual(result, projectInfo);
    });

    it("returns null on error", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: false,
        status: 404,
      }));

      const result = await getProjectInfo("http://localhost:4096", { fetch: mockFetch });

      assert.strictEqual(result, null);
    });
  });

  describe("resolveWorktreeDirectory", () => {
    it("returns base directory when no worktree config", async () => {
      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        {}
      );

      assert.strictEqual(result.directory, "/path/to/project");
    });

    it("returns base directory when worktree is undefined", async () => {
      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: undefined }
      );

      assert.strictEqual(result.directory, "/path/to/project");
    });

    it("creates new worktree when worktree is 'new'", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          name: "test-worktree",
          branch: "opencode/test-worktree",
          directory: "/data/worktree/abc123/test-worktree",
        }),
      }));

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "new" },
        { fetch: mockFetch }
      );

      assert.strictEqual(result.directory, "/data/worktree/abc123/test-worktree");
      assert.strictEqual(result.worktreeCreated, true);
    });

    it("passes worktreeName when creating new worktree", async () => {
      const mockFetch = mock.fn(async (url, opts) => {
        // First call: GET /experimental/worktree (list) - return empty to trigger creation
        if (!opts || opts.method !== 'POST') {
          return {
            ok: true,
            json: async () => [],
          };
        }
        // Second call: POST /experimental/worktree (create)
        return {
          ok: true,
          json: async () => ({
            name: "my-feature",
            branch: "opencode/my-feature",
            directory: "/data/worktree/abc123/my-feature",
          }),
        };
      });

      await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "new", worktreeName: "my-feature" },
        { fetch: mockFetch }
      );

      // Should have called both list (GET) and create (POST)
      assert.strictEqual(mockFetch.mock.calls.length, 2);
      // Second call should be POST with the worktree name
      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall.arguments[1].body);
      assert.strictEqual(body.name, "my-feature");
    });

    it("returns error when no server running", async () => {
      const result = await resolveWorktreeDirectory(
        null,
        "/path/to/project",
        { worktree: "new" }
      );

      assert.strictEqual(result.directory, "/path/to/project");
      assert.ok(result.error.includes("no server"));
    });

    it("returns error when no server running for named worktree", async () => {
      const result = await resolveWorktreeDirectory(
        null,
        "/path/to/project",
        { worktree: "my-feature" }
      );

      assert.strictEqual(result.directory, "/path/to/project");
      assert.ok(result.error.includes("no server"));
    });

    it("looks up named worktree from sandboxes", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => [
          "/data/worktree/abc123/brave-falcon",
          "/data/worktree/abc123/my-feature",
        ],
      }));

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "my-feature" },
        { fetch: mockFetch }
      );

      assert.strictEqual(result.directory, "/data/worktree/abc123/my-feature");
    });

    it("reuses existing sandbox when worktree='new' and worktreeName matches", async () => {
      let postCalled = false;
      let listUrl = null;
      const mockFetch = mock.fn(async (url, opts) => {
        // GET /experimental/worktree (list) - returns existing sandbox with matching name
        if (!opts || opts.method !== 'POST') {
          listUrl = url;
          return {
            ok: true,
            json: async () => [
              "/data/worktree/abc123/other-branch",
              "/data/worktree/abc123/my-feature",  // matches worktreeName
            ],
          };
        }
        // POST /experimental/worktree (create) - should NOT be called
        postCalled = true;
        return { ok: true, json: async () => ({}) };
      });

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "new", worktreeName: "my-feature" },
        { fetch: mockFetch }
      );

      // Should reuse existing sandbox
      assert.strictEqual(result.directory, "/data/worktree/abc123/my-feature");
      assert.strictEqual(result.worktreeReused, true);
      assert.strictEqual(result.worktreeCreated, undefined);
      // POST should NOT have been called
      assert.strictEqual(postCalled, false, "Should not call POST when reusing existing sandbox");
      // listWorktrees should be called with directory parameter
      assert.ok(listUrl.includes("directory="), "Should pass directory to listWorktrees");
      assert.ok(listUrl.includes(encodeURIComponent("/path/to/project")), "Should pass correct project directory");
    });

    it("creates new sandbox when worktree='new' and no matching name exists", async () => {
      let getCalled = false;
      let postCalled = false;
      const mockFetch = mock.fn(async (url, opts) => {
        // GET /experimental/worktree (list) - no matching name
        if (!opts || opts.method !== 'POST') {
          getCalled = true;
          return {
            ok: true,
            json: async () => ["/data/worktree/abc123/other-branch"],
          };
        }
        // POST /experimental/worktree (create)
        postCalled = true;
        return {
          ok: true,
          json: async () => ({
            name: "new-feature",
            branch: "opencode/new-feature",
            directory: "/data/worktree/abc123/new-feature",
          }),
        };
      });

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "new", worktreeName: "new-feature" },
        { fetch: mockFetch }
      );

      // Should create new sandbox
      assert.strictEqual(result.directory, "/data/worktree/abc123/new-feature");
      assert.strictEqual(result.worktreeCreated, true);
      assert.strictEqual(result.worktreeReused, undefined);
      // Both GET and POST should have been called
      assert.strictEqual(getCalled, true, "Should call GET to list existing worktrees");
      assert.strictEqual(postCalled, true, "Should call POST to create new worktree");
    });

    it("skips sandbox reuse when preferExistingSandbox is false", async () => {
      let getCalled = false;
      const mockFetch = mock.fn(async (url, opts) => {
        // GET /experimental/worktree - should NOT be called
        if (!opts || opts.method !== 'POST') {
          getCalled = true;
          return { ok: true, json: async () => ["/data/worktree/abc123/my-feature"] };
        }
        // POST /experimental/worktree (create)
        return {
          ok: true,
          json: async () => ({
            name: "my-feature",
            branch: "opencode/my-feature",
            directory: "/data/worktree/abc123/my-feature-new",
          }),
        };
      });

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "new", worktreeName: "my-feature", preferExistingSandbox: false },
        { fetch: mockFetch }
      );

      // Should create new sandbox, not reuse
      assert.strictEqual(result.directory, "/data/worktree/abc123/my-feature-new");
      assert.strictEqual(result.worktreeCreated, true);
      // GET should NOT have been called (skipped reuse check)
      assert.strictEqual(getCalled, false, "Should skip GET when preferExistingSandbox is false");
    });

    it("returns error when named worktree not found", async () => {
      const mockFetch = mock.fn(async () => ({
        ok: true,
        json: async () => ["/data/worktree/abc123/other-worktree"],
      }));

      const result = await resolveWorktreeDirectory(
        "http://localhost:4096",
        "/path/to/project",
        { worktree: "nonexistent" },
        { fetch: mockFetch }
      );

      assert.strictEqual(result.directory, "/path/to/project");
      assert.ok(result.error.includes("not found"));
    });
  });
});
