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
