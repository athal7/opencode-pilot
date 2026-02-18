/**
 * Integration tests for session and sandbox reuse
 * 
 * These tests verify the actual API interactions work correctly.
 * They use a mock server that simulates OpenCode's behavior.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";

import {
  listSessions,
  findReusableSession,
  isSessionArchived,
  sendMessageToSession,
  executeAction,
} from "../../service/actions.js";

import {
  listWorktrees,
  resolveWorktreeDirectory,
} from "../../service/worktree.js";

import {
  computeAttentionLabels,
} from "../../service/poller.js";

import {
  evaluateReadiness,
} from "../../service/readiness.js";

/**
 * Create a mock OpenCode server for testing
 */
function createMockServer(handlers = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    const directory = url.searchParams.get("directory");

    // Collect request body
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = {
        method,
        path,
        directory,
        query: Object.fromEntries(url.searchParams),
        body: body ? JSON.parse(body) : null,
      };

      // Find matching handler
      const handlerKey = `${method} ${path}`;
      const handler = handlers[handlerKey] || handlers.default;

      if (handler) {
        const result = handler(request);
        res.writeHead(result.status || 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        server,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("integration: session reuse", () => {
  let mockServer;

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  it("listSessions passes directory parameter to server", async () => {
    let receivedDirectory = null;

    mockServer = await createMockServer({
      "GET /session": (req) => {
        receivedDirectory = req.directory;
        return {
          body: [
            { id: "ses_1", directory: "/path/to/project", time: { created: 1000, updated: 2000 } },
          ],
        };
      },
    });

    const sessions = await listSessions(mockServer.url, { directory: "/path/to/project" });

    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(receivedDirectory, "/path/to/project", "Server should receive directory parameter");
  });

  it("findReusableSession filters out archived sessions", async () => {
    mockServer = await createMockServer({
      "GET /session": () => ({
        body: [
          { id: "ses_archived", directory: "/proj", time: { created: 1000, updated: 3000, archived: 4000 } },
          { id: "ses_active", directory: "/proj", time: { created: 2000, updated: 2500 } },
        ],
      }),
      "GET /session/status": () => ({ body: {} }),
    });

    const session = await findReusableSession(mockServer.url, "/proj");

    assert.ok(session, "Should find a session");
    assert.strictEqual(session.id, "ses_active", "Should return the active session, not archived");
  });

  it("findReusableSession prefers idle sessions over busy", async () => {
    mockServer = await createMockServer({
      "GET /session": () => ({
        body: [
          { id: "ses_busy", directory: "/proj", time: { created: 1000, updated: 3000 } },
          { id: "ses_idle", directory: "/proj", time: { created: 2000, updated: 2000 } },
        ],
      }),
      "GET /session/status": () => ({
        body: { ses_busy: { type: "busy" } },
      }),
    });

    const session = await findReusableSession(mockServer.url, "/proj");

    assert.strictEqual(session.id, "ses_idle", "Should prefer idle session even with older update time");
  });

  it("sendMessageToSession updates title and posts message", async () => {
    let titleUpdated = false;
    let messagePosted = false;
    let postedBody = null;

    mockServer = await createMockServer({
      "PATCH /session/ses_123": (req) => {
        titleUpdated = req.body?.title === "New Title";
        return { body: {} };
      },
      "POST /session/ses_123/message": (req) => {
        messagePosted = true;
        postedBody = req.body;
        return { body: { success: true } };
      },
    });

    const result = await sendMessageToSession(
      mockServer.url,
      "ses_123",
      "/proj",
      "Hello world",
      { title: "New Title", agent: "plan" }
    );

    assert.ok(result.success);
    assert.strictEqual(result.reused, true);
    assert.ok(titleUpdated, "Should update session title");
    assert.ok(messagePosted, "Should post message");
    assert.strictEqual(postedBody.parts[0].text, "Hello world");
    assert.strictEqual(postedBody.agent, "plan");
  });

  it("executeAction reuses existing session when available", async () => {
    let sessionCreated = false;
    let messageSessionId = null;

    mockServer = await createMockServer({
      "GET /session": () => ({
        body: [{ id: "ses_existing", directory: "/proj", time: { created: 1000, updated: 2000 } }],
      }),
      "GET /session/status": () => ({ body: {} }),
      "POST /session": () => {
        sessionCreated = true;
        return { body: { id: "ses_new" } };
      },
      "PATCH /session/ses_existing": () => ({ body: {} }),
      "POST /session/ses_existing/message": (req) => {
        messageSessionId = "ses_existing";
        return { body: { success: true } };
      },
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", time: { created: 1000, updated: 2000 }, sandboxes: [] },
      }),
    });

    const result = await executeAction(
      { number: 123, title: "Test issue" },
      { path: "/proj", prompt: "default" },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success);
    assert.strictEqual(result.sessionReused, true, "Should indicate session was reused");
    assert.strictEqual(sessionCreated, false, "Should NOT create new session");
    assert.strictEqual(messageSessionId, "ses_existing", "Should post to existing session");
  });

  it("executeAction creates new session when all existing are archived", async () => {
    let sessionCreated = false;

    mockServer = await createMockServer({
      "GET /session": () => ({
        body: [{ id: "ses_archived", directory: "/proj", time: { created: 1000, archived: 2000 } }],
      }),
      "GET /session/status": () => ({ body: {} }),
      "POST /session": () => {
        sessionCreated = true;
        return { body: { id: "ses_new" } };
      },
      "PATCH /session/ses_new": () => ({ body: {} }),
      "POST /session/ses_new/message": () => ({ body: { success: true } }),
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", time: { created: 1000, updated: 2000 }, sandboxes: [] },
      }),
    });

    const result = await executeAction(
      { number: 456, title: "Test" },
      { path: "/proj", prompt: "default" },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success);
    assert.strictEqual(result.sessionReused, undefined, "Should NOT indicate session was reused");
    assert.ok(sessionCreated, "Should create new session when existing is archived");
  });
});

describe("integration: sandbox reuse", () => {
  let mockServer;

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  it("listWorktrees passes directory parameter to server", async () => {
    let receivedDirectory = null;

    mockServer = await createMockServer({
      "GET /experimental/worktree": (req) => {
        receivedDirectory = req.directory;
        return { body: ["/worktree/branch-1"] };
      },
    });

    const worktrees = await listWorktrees(mockServer.url, { directory: "/path/to/project" });

    assert.strictEqual(worktrees.length, 1);
    assert.strictEqual(receivedDirectory, "/path/to/project", "Server should receive directory parameter");
  });

  it("resolveWorktreeDirectory reuses existing sandbox when name matches", async () => {
    let postCalled = false;
    let listDirectory = null;

    mockServer = await createMockServer({
      "GET /experimental/worktree": (req) => {
        listDirectory = req.directory;
        return {
          body: [
            "/worktree/other-branch",
            "/worktree/my-feature",
          ],
        };
      },
      "POST /experimental/worktree": () => {
        postCalled = true;
        return { body: { name: "my-feature", directory: "/worktree/my-feature-new" } };
      },
    });

    const result = await resolveWorktreeDirectory(
      mockServer.url,
      "/path/to/project",
      { worktree: "new", worktreeName: "my-feature" }
    );

    assert.strictEqual(result.directory, "/worktree/my-feature");
    assert.strictEqual(result.worktreeReused, true);
    assert.strictEqual(postCalled, false, "Should NOT create new worktree");
    assert.strictEqual(listDirectory, "/path/to/project", "Should pass directory to list worktrees");
  });

  it("resolveWorktreeDirectory creates new sandbox when name doesn't match", async () => {
    let postCalled = false;
    let postDirectory = null;

    mockServer = await createMockServer({
      "GET /experimental/worktree": () => ({
        body: ["/worktree/other-branch"],
      }),
      "POST /experimental/worktree": (req) => {
        postCalled = true;
        postDirectory = req.directory;
        return {
          body: {
            name: "new-feature",
            branch: "opencode/new-feature",
            directory: "/worktree/new-feature",
          },
        };
      },
    });

    const result = await resolveWorktreeDirectory(
      mockServer.url,
      "/path/to/project",
      { worktree: "new", worktreeName: "new-feature" }
    );

    assert.strictEqual(result.directory, "/worktree/new-feature");
    assert.strictEqual(result.worktreeCreated, true);
    assert.ok(postCalled, "Should create new worktree");
    assert.strictEqual(postDirectory, "/path/to/project", "Should pass directory to create worktree");
  });

  it("resolveWorktreeDirectory passes directory when looking up named worktree", async () => {
    let listDirectory = null;

    mockServer = await createMockServer({
      "GET /experimental/worktree": (req) => {
        listDirectory = req.directory;
        return { body: ["/worktree/my-branch"] };
      },
    });

    const result = await resolveWorktreeDirectory(
      mockServer.url,
      "/path/to/project",
      { worktree: "my-branch" }
    );

    assert.strictEqual(result.directory, "/worktree/my-branch");
    assert.strictEqual(listDirectory, "/path/to/project", "Should pass directory when looking up named worktree");
  });
});

describe("integration: PR attention detection", () => {
  /**
   * These tests verify the full flow of PR attention detection:
   * 1. PRs with merge conflicts should be detected as needing attention
   * 2. PRs with human feedback should be detected as needing attention
   * 3. PRs with only bot comments but conflicts should still be ready (require_attention mode)
   * 4. computeAttentionLabels + evaluateReadiness work together correctly
   */

  it("PR with conflicts and only bot comments is ready when require_attention is set", () => {
    // This is the key scenario that was broken: PR has merge conflicts but no human feedback
    // With require_attention, it should be ready because conflicts count as "attention needed"
    const items = [{
      number: 123,
      title: "Test PR",
      user: { login: "author" },
      _mergeable: "CONFLICTING",
      _comments: [
        { user: { login: "github-actions[bot]", type: "Bot" }, body: "CI passed" },
        { user: { login: "codecov[bot]", type: "Bot" }, body: "Coverage report" },
      ],
    }];

    // Step 1: Compute attention labels (happens in poll-service)
    const labeled = computeAttentionLabels(items, {});
    
    assert.strictEqual(labeled[0]._attention_label, "Conflicts");
    assert.strictEqual(labeled[0]._has_attention, true);

    // Step 2: Evaluate readiness with require_attention config
    const config = {
      readiness: {
        require_attention: true,
      },
    };
    const result = evaluateReadiness(labeled[0], config);

    assert.strictEqual(result.ready, true, "PR with conflicts should be ready even with only bot comments");
  });

  it("PR with human feedback is ready when require_attention is set", () => {
    const items = [{
      number: 456,
      title: "Another PR",
      user: { login: "author" },
      _mergeable: "MERGEABLE",
      _comments: [
        { user: { login: "reviewer", type: "User" }, body: "Please fix the tests" },
      ],
    }];

    const labeled = computeAttentionLabels(items, {});
    
    assert.strictEqual(labeled[0]._attention_label, "Feedback");
    assert.strictEqual(labeled[0]._has_attention, true);

    const config = {
      readiness: {
        require_attention: true,
      },
    };
    const result = evaluateReadiness(labeled[0], config);

    assert.strictEqual(result.ready, true, "PR with human feedback should be ready");
  });

  it("PR with both conflicts and feedback shows combined label", () => {
    const items = [{
      number: 789,
      title: "Complex PR",
      user: { login: "author" },
      _mergeable: "CONFLICTING",
      _comments: [
        { user: { login: "reviewer", type: "User" }, body: "Needs changes" },
      ],
    }];

    const labeled = computeAttentionLabels(items, {});
    
    assert.strictEqual(labeled[0]._attention_label, "Conflicts+Feedback");
    assert.strictEqual(labeled[0]._has_attention, true);

    const config = {
      readiness: {
        require_attention: true,
      },
    };
    const result = evaluateReadiness(labeled[0], config);

    assert.strictEqual(result.ready, true);
  });

  it("PR without conflicts or feedback is NOT ready when require_attention is set", () => {
    const items = [{
      number: 999,
      title: "Clean PR",
      user: { login: "author" },
      _mergeable: "MERGEABLE",
      _comments: [
        { user: { login: "github-actions[bot]", type: "Bot" }, body: "CI passed" },
      ],
    }];

    const labeled = computeAttentionLabels(items, {});
    
    assert.strictEqual(labeled[0]._attention_label, "PR");
    assert.strictEqual(labeled[0]._has_attention, false);

    const config = {
      readiness: {
        require_attention: true,
      },
    };
    const result = evaluateReadiness(labeled[0], config);

    assert.strictEqual(result.ready, false, "PR without attention conditions should NOT be ready");
    assert.ok(result.reason.includes("no attention needed"), "Should have appropriate reason");
  });

  it("PR with only bot comments is NOT ready when require_attention is NOT set", () => {
    // Without require_attention, the strict bot check applies
    const pr = {
      number: 111,
      title: "Test",
      user: { login: "author" },
      _comments: [
        { user: { login: "github-actions[bot]", type: "Bot" }, body: "CI passed" },
      ],
    };

    const config = {}; // No require_attention

    const result = evaluateReadiness(pr, config);

    assert.strictEqual(result.ready, false, "Without require_attention, bot-only comments should fail");
    assert.ok(result.reason.includes("bot"), "Should mention bot in reason");
  });
});

describe("integration: worktree creation with worktree_name", () => {
  let mockServer;

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  it("executeAction creates worktree when worktree_name is set but project has no sandboxes", async () => {
    let worktreeListCalled = false;
    let worktreeCreateCalled = false;
    let createdWorktreeName = null;
    let sessionCreated = false;
    let sessionDirectory = null;

    mockServer = await createMockServer({
      // Project has no sandboxes
      "GET /project": () => ({
        body: [{ id: "proj_1", worktree: "/proj", sandboxes: [], time: { created: 1 } }],
      }),
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", sandboxes: [], time: { created: 1 } },
      }),
      // No existing worktrees
      "GET /experimental/worktree": () => {
        worktreeListCalled = true;
        return { body: [] };
      },
      // Worktree creation
      "POST /experimental/worktree": (req) => {
        worktreeCreateCalled = true;
        createdWorktreeName = req.body?.name;
        return {
          body: {
            name: req.body?.name || "new-wt",
            directory: `/worktree/${req.body?.name || "new-wt"}`,
          },
        };
      },
      // No existing sessions
      "GET /session": () => ({ body: [] }),
      "GET /session/status": () => ({ body: {} }),
      // Session creation
      "POST /session": (req) => {
        sessionCreated = true;
        // Extract directory from URL
        const url = new URL(req.path, "http://localhost");
        sessionDirectory = req.query?.directory;
        return { body: { id: "ses_new" } };
      },
      "PATCH /session/ses_new": () => ({ body: {} }),
      "POST /session/ses_new/message": () => ({ body: { success: true } }),
    });

    const result = await executeAction(
      { number: 42, title: "Review PR" },
      { 
        path: "/proj", 
        prompt: "review",
        worktree_name: "pr-{number}", // This should trigger worktree creation
      },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success, "Action should succeed");
    assert.ok(worktreeListCalled, "Should check for existing worktrees");
    assert.ok(worktreeCreateCalled, "Should create worktree when worktree_name is configured");
    assert.strictEqual(createdWorktreeName, "pr-42", "Should expand worktree_name template");
    assert.ok(sessionCreated, "Should create session");
    // Session creation uses the project directory (for correct projectID scoping)
    // The worktree path is used for messages/commands (file operations)
    assert.strictEqual(sessionDirectory, "/proj", "Session should be scoped to project directory");
  });

  it("reuses stored directory when reprocessing same item", async () => {
    // This tests the scenario where:
    // 1. Item was processed before, worktree created with random name (e.g., "calm-wizard")
    // 2. Item triggers again (e.g., new feedback)
    // 3. We should reuse the stored directory, not create a new worktree
    
    let worktreeListCalled = false;
    let worktreeCreateCalled = false;
    let sessionDirectory = null;
    
    // Existing worktree has a random name, not "pr-42"
    const existingWorktreeDir = "/worktree/calm-wizard";
    
    const mockServer = await createMockServer({
      "GET /experimental/worktree": () => {
        worktreeListCalled = true;
        // Return existing worktree with random name
        return { body: [existingWorktreeDir] };
      },
      "POST /experimental/worktree": () => {
        worktreeCreateCalled = true;
        return { body: { name: "pr-42", directory: "/worktree/pr-42" } };
      },
      "GET /session": () => ({ body: [] }),
      "GET /session/status": () => ({ body: {} }),
      "POST /session": (req) => {
        sessionDirectory = req.query?.directory;
        return { body: { id: "ses_reprocess" } };
      },
      "PATCH /session/ses_reprocess": () => ({ body: {} }),
      "POST /session/ses_reprocess/message": () => ({ body: { success: true } }),
    });

    // Simulate reprocessing with a stored directory from previous run
    const result = await executeAction(
      { number: 42, title: "Review PR" },
      { 
        path: "/proj", 
        prompt: "review",
        worktree_name: "pr-{number}",
        // This is the key: pass the directory we used last time
        existing_directory: existingWorktreeDir,
      },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success, "Action should succeed");
    // Should NOT create a new worktree since we have existing_directory
    assert.strictEqual(worktreeCreateCalled, false, "Should NOT create new worktree when existing_directory provided");
    // Session creation uses the project directory (for correct projectID scoping)
    assert.strictEqual(sessionDirectory, "/proj", "Session should be scoped to project directory");
  });

  it("session reuse queries by project directory, not worktree directory", async () => {
    // This tests the key fix: when reprocessing an item with a worktree,
    // findReusableSession should query by the project directory (e.g., /proj)
    // so it finds sessions created with correct scoping (v0.24.7+), rather
    // than finding old sessions created with the worktree directory (projectID "global").
    
    let sessionQueryDirectory = null;
    let sessionCreated = false;
    
    const existingWorktreeDir = "/worktree/calm-wizard";
    
    mockServer = await createMockServer({
      "GET /project": () => ({
        body: [{ id: "proj_1", worktree: "/proj", sandboxes: [], time: { created: 1 } }],
      }),
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", sandboxes: [], time: { created: 1 } },
      }),
      "GET /experimental/worktree": () => ({
        body: [existingWorktreeDir],
      }),
      "GET /session": (req) => {
        sessionQueryDirectory = req.directory;
        // Return a session ONLY if queried by project directory
        if (req.directory === "/proj") {
          return {
            body: [{ id: "ses_proj_scoped", directory: "/proj", time: { created: 1000, updated: 2000 } }],
          };
        }
        // Old worktree-scoped sessions should NOT be found when querying by project dir
        return { body: [] };
      },
      "GET /session/status": () => ({ body: {} }),
      "POST /session": (req) => {
        sessionCreated = true;
        return { body: { id: "ses_new" } };
      },
      "PATCH /session/ses_proj_scoped": () => ({ body: {} }),
      "POST /session/ses_proj_scoped/message": () => ({ body: { success: true } }),
      "POST /session/ses_proj_scoped/command": () => ({ body: { success: true } }),
      "PATCH /session/ses_new": () => ({ body: {} }),
      "POST /session/ses_new/message": () => ({ body: { success: true } }),
      "POST /session/ses_new/command": () => ({ body: { success: true } }),
    });

    const result = await executeAction(
      { number: 42, title: "Review PR" },
      { 
        path: "/proj", 
        prompt: "review",
        worktree_name: "pr-{number}",
        existing_directory: existingWorktreeDir,
      },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success, "Action should succeed");
    // The session lookup should use the PROJECT directory, not the worktree directory
    assert.strictEqual(sessionQueryDirectory, "/proj",
      "findReusableSession should query by project directory, not worktree");
    // Should reuse the project-scoped session, NOT create a new one
    assert.strictEqual(result.sessionReused, true, "Should reuse the project-scoped session");
    assert.strictEqual(sessionCreated, false, "Should NOT create a new session when project-scoped session exists");
  });
});

describe("integration: cross-source deduplication", () => {
  /**
   * These tests verify cross-source deduplication:
   * When a Linear issue and a GitHub PR are linked (PR mentions Linear ID),
   * only one session should be created.
   */

  it("computeDedupKeys extracts Linear refs from GitHub PR", async () => {
    const { computeDedupKeys } = await import("../../service/poller.js");

    // Simulated GitHub PR that mentions a Linear issue
    const pr = {
      id: "https://github.com/myorg/backend/pull/456",
      number: 456,
      repository_full_name: "myorg/backend",
      title: "ENG-123: Implement new feature",
      body: "This PR implements the feature requested in ENG-123.\n\nCloses #789",
    };

    const keys = computeDedupKeys(pr);

    // Should include:
    // 1. PR's own canonical key
    // 2. Linear issue ref from title
    // 3. GitHub issue ref from body (relative, needs context)
    assert.ok(keys.includes("github:myorg/backend#456"), "Should have PR's canonical key");
    assert.ok(keys.includes("linear:ENG-123"), "Should extract Linear ref from title");
  });

  it("computeDedupKeys generates canonical key for Linear issues", async () => {
    const { computeDedupKeys } = await import("../../service/poller.js");

    // Simulated Linear issue (number is the identifier like "ENG-123")
    const issue = {
      id: "linear:abc-123-uuid",
      number: "ENG-123", // Linear preset extracts this from URL
      title: "Implement new feature",
      body: "Description of the feature",
    };

    const keys = computeDedupKeys(issue);

    assert.ok(keys.includes("linear:ENG-123"), "Should have Linear issue's canonical key");
  });

  it("poller detects duplicate via shared dedup key", async () => {
    const { createPoller } = await import("../../service/poller.js");
    const { mkdtempSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tempDir = mkdtempSync(join(tmpdir(), "dedup-test-"));
    const stateFile = join(tempDir, "poll-state.json");

    try {
      const poller = createPoller({ stateFile });

      // Linear issue ENG-123 is processed first
      poller.markProcessed("linear:abc-uuid", {
        source: "linear/my-issues",
        dedupKeys: ["linear:ENG-123"],
      });

      // GitHub PR comes in with ENG-123 in title
      const prDedupKeys = ["github:myorg/backend#456", "linear:ENG-123"];
      
      // Should find the Linear issue via shared dedup key
      const existingItemId = poller.findProcessedByDedupKey(prDedupKeys);
      
      assert.strictEqual(existingItemId, "linear:abc-uuid", 
        "PR should be detected as duplicate of Linear issue via shared ENG-123 key");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("dedup key index is rebuilt on load if missing from old state file", async () => {
    const { createPoller } = await import("../../service/poller.js");
    const { mkdtempSync, rmSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tempDir = mkdtempSync(join(tmpdir(), "dedup-migration-test-"));
    const stateFile = join(tempDir, "poll-state.json");

    try {
      // Simulate old state file without dedupKeys index (migration scenario)
      const oldState = {
        processed: {
          "linear:abc-uuid": {
            processedAt: new Date().toISOString(),
            source: "linear",
            dedupKeys: ["linear:ENG-123"], // Keys are in item metadata
          },
        },
        // No dedupKeys index at top level
        savedAt: new Date().toISOString(),
      };
      writeFileSync(stateFile, JSON.stringify(oldState));

      // Load poller - should rebuild index from item metadata
      const poller = createPoller({ stateFile });

      // Should still be able to find by dedup key
      const foundId = poller.findProcessedByDedupKey(["linear:ENG-123"]);
      assert.strictEqual(foundId, "linear:abc-uuid", 
        "Should rebuild dedup index from processed items on load");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("integration: stacked PR session reuse", () => {
  let mockServer;

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  it("reuses stack sibling's session when reuse_stack_session is set", async () => {
    let sessionCreated = false;
    let messageSessionId = null;
    let messageTitleUpdated = null;

    mockServer = await createMockServer({
      "GET /session": () => ({
        // Return the stack sibling's session
        body: [{ id: "ses_stack_sibling", directory: "/wt/pr-101", time: { created: 1000, updated: 2000 } }],
      }),
      "GET /session/status": () => ({ body: {} }),
      "POST /session": () => {
        sessionCreated = true;
        return { body: { id: "ses_new" } };
      },
      "PATCH /session/ses_stack_sibling": (req) => {
        messageTitleUpdated = req.body?.title;
        return { body: {} };
      },
      "POST /session/ses_stack_sibling/message": (req) => {
        messageSessionId = "ses_stack_sibling";
        return { body: { success: true } };
      },
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", time: { created: 1000, updated: 2000 }, sandboxes: [] },
      }),
    });

    const result = await executeAction(
      { number: 102, title: "Part 2 of feature" },
      {
        path: "/proj",
        prompt: "default",
        // These are set by poll-service when a stack sibling is found
        existing_directory: "/wt/pr-101",
        reuse_stack_session: "ses_stack_sibling",
      },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success, "Action should succeed");
    assert.strictEqual(result.sessionReused, true, "Should indicate session was reused");
    assert.strictEqual(sessionCreated, false, "Should NOT create new session");
    assert.strictEqual(messageSessionId, "ses_stack_sibling", "Should post to stack sibling's session");
  });

  it("falls back to normal flow when stack session is gone", async () => {
    let sessionCreated = false;
    let newSessionMessageId = null;

    mockServer = await createMockServer({
      "GET /session": () => ({
        // No sessions exist (sibling's session was archived/gone)
        body: [],
      }),
      "GET /session/status": () => ({ body: {} }),
      // Stack session reuse will try this and fail
      "PATCH /session/ses_gone": () => ({
        status: 404,
        body: { error: "Session not found" },
      }),
      "POST /session/ses_gone/message": () => ({
        status: 404,
        body: { error: "Session not found" },
      }),
      // Falls through to creating a new session
      "POST /session": () => {
        sessionCreated = true;
        return { body: { id: "ses_new_fallback" } };
      },
      "PATCH /session/ses_new_fallback": () => ({ body: {} }),
      "POST /session/ses_new_fallback/message": (req) => {
        newSessionMessageId = "ses_new_fallback";
        return { body: { success: true } };
      },
      "GET /project/current": () => ({
        body: { id: "proj_1", worktree: "/proj", time: { created: 1000, updated: 2000 }, sandboxes: [] },
      }),
    });

    const result = await executeAction(
      { number: 102, title: "Part 2 of feature" },
      {
        path: "/proj",
        prompt: "default",
        existing_directory: "/wt/pr-101",
        reuse_stack_session: "ses_gone",
      },
      { discoverServer: async () => mockServer.url }
    );

    assert.ok(result.success, "Action should succeed via fallback");
    assert.ok(sessionCreated, "Should create new session when stack session is gone");
  });

  it("detectStacks + poller metadata enables stack reuse across poll cycles", async () => {
    // This test verifies the full flow:
    // 1. PR #101 was processed in a previous poll cycle (has sessionId + directory in metadata)
    // 2. PR #102 is in the same stack (detected via detectStacks)
    // 3. poll-service should set reuse_stack_session from sibling metadata

    const { createPoller, detectStacks } = await import("../../service/poller.js");
    const { mkdtempSync, rmSync: rmSyncFs } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tempDir = mkdtempSync(join(tmpdir(), "stack-reuse-test-"));
    const stateFile = join(tempDir, "poll-state.json");

    try {
      const poller = createPoller({ stateFile });

      // Simulate: PR #101 was processed in a previous poll cycle
      poller.markProcessed("https://github.com/myorg/app/pull/101", {
        source: "review-requests",
        directory: "/wt/pr-101",
        sessionId: "ses_pr101",
      });

      // Current poll returns both PRs with branch refs
      const items = [
        {
          id: "https://github.com/myorg/app/pull/101",
          number: 101,
          repository_full_name: "myorg/app",
          _baseRefName: "main",
          _headRefName: "feature-part-1",
        },
        {
          id: "https://github.com/myorg/app/pull/102",
          number: 102,
          repository_full_name: "myorg/app",
          _baseRefName: "feature-part-1",
          _headRefName: "feature-part-2",
        },
      ];

      // Detect stacks
      const stackMap = detectStacks(items);

      assert.ok(stackMap.has(items[1].id), "PR #102 should be in a stack");

      // Simulate what poll-service does: look up sibling metadata
      const siblings = stackMap.get(items[1].id);
      let foundSessionId = null;
      let foundDirectory = null;

      for (const siblingId of siblings) {
        const meta = poller.getProcessedMeta(siblingId);
        if (meta?.sessionId && meta?.directory) {
          foundSessionId = meta.sessionId;
          foundDirectory = meta.directory;
          break;
        }
      }

      assert.strictEqual(foundSessionId, "ses_pr101", "Should find PR #101's session ID");
      assert.strictEqual(foundDirectory, "/wt/pr-101", "Should find PR #101's directory");
    } finally {
      rmSyncFs(tempDir, { recursive: true, force: true });
    }
  });
});
