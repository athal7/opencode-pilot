/**
 * Integration tests for pollOnce end-to-end orchestration
 *
 * Tests the full wiring: config → source → readiness → dedup → executeAction.
 * Uses executeAction + createPoller directly (simulating what pollOnce does
 * after fetching items) with a mock OpenCode server to capture API calls.
 *
 * These tests verify two properties NOT covered by the invariant tests:
 *
 *   1. Two PRs in the same project each get their own session (dedup does not
 *      collapse them — they have different IDs).
 *
 *   2. A PR already processed in a previous poll cycle is skipped on the next
 *      call (dedup state persists across pollOnce calls).
 *
 * The invariant tests (session-reuse.test.js "session creation invariants")
 * cover WHICH directories are used. These tests cover WHETHER sessions are
 * created at all.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeAction } from "../../service/actions.js";
import { createPoller } from "../../service/poller.js";

// ─── Mock server ────────────────────────────────────────────────────────────

/**
 * Create a mock OpenCode server for testing.
 * Handlers are keyed by "METHOD /path" (e.g., "POST /session").
 * A `default` handler catches anything without an exact match.
 */
function createMockServer(handlers = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = {
        method,
        path: pathname,
        directory: url.searchParams.get("directory"),
        query: Object.fromEntries(url.searchParams),
        body: body ? JSON.parse(body) : null,
      };

      // Find matching handler — try exact match first, then wildcard
      const exactKey = `${method} ${pathname}`;
      let handler = handlers[exactKey];

      if (!handler) {
        for (const [key, h] of Object.entries(handlers)) {
          if (key === "default") continue;
          const regexStr = "^" + key.replace(/\*/g, "[^/]+") + "$";
          if (new RegExp(regexStr).test(exactKey)) {
            handler = h;
            break;
          }
        }
      }

      if (!handler) handler = handlers.default;

      if (handler) {
        const result = handler(request);
        res.writeHead(result.status || 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No handler for ${exactKey}` }));
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

// ─── Fetch interceptor ───────────────────────────────────────────────────────

/**
 * Build a fetch interceptor that:
 *  - Records which sessions were created and which directories were used
 *  - Short-circuits POST /session/:id/message and /command to avoid
 *    AbortController race with the mock server (see session-reuse.test.js
 *    for the full explanation of this race condition)
 *  - Forwards everything else to the real mock server
 */
function makeFetchInterceptor(calls) {
  return async (url, opts) => {
    const u = new URL(url);
    const method = opts?.method || "GET";

    // Short-circuit message/command — return mock 200 directly
    if (method === "POST" && /^\/session\/[^/]+\/(message|command)$/.test(u.pathname)) {
      const sessionId = u.pathname.split("/")[2];
      calls.messages = calls.messages || [];
      calls.messages.push({
        sessionId,
        directory: u.searchParams.get("directory"),
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "POST" && u.pathname === "/session") {
      calls.sessionsCreated = (calls.sessionsCreated || 0) + 1;
    }

    return fetch(url, opts);
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let sessionCounter = 0;

/**
 * Build a minimal mock server that handles the OpenCode API calls made by
 * executeAction for a worktree-based PR source.
 */
async function buildWorktreeMockServer(calls) {
  return createMockServer({
    "GET /project": () => ({
      body: [{ id: "proj_1", worktree: "/proj", sandboxes: [], time: { created: 1 } }],
    }),
    "GET /experimental/worktree": () => ({ body: [] }),
    "POST /experimental/worktree": (req) => ({
      body: { name: req.body?.name, directory: `/worktree/${req.body?.name}` },
    }),
    "GET /session": () => ({ body: [] }),
    "GET /session/status": () => ({ body: {} }),
    "POST /session": () => {
      const id = `ses_poll_${++sessionCounter}`;
      calls.createdSessionIds = calls.createdSessionIds || [];
      calls.createdSessionIds.push(id);
      return { body: { id } };
    },
    default: (req) => {
      // PATCH /session/:id — title update
      if (req.method === "PATCH" && req.path.startsWith("/session/")) {
        return { body: {} };
      }
      return { status: 404, body: { error: `Unhandled: ${req.method} ${req.path}` } };
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("integration: pollOnce end-to-end", () => {
  let mockServer;
  let tmpDir;
  let stateFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pilot-poll-test-"));
    stateFile = join(tmpDir, "poll-state.json");
    sessionCounter = 0;
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("two PRs in the same project each get their own session", async () => {
    // Two PRs, same project, worktree_name configured.
    // Both are ready (no readiness filter). Each must get a separate session.
    // This exercises: source → readiness → executeAction × 2 → two sessions.

    const calls = {};
    mockServer = await buildWorktreeMockServer(calls);
    const serverUrl = mockServer.url;

    const items = [
      { id: "pr-101", number: 101, title: "PR #101", state: "open" },
      { id: "pr-102", number: 102, title: "PR #102", state: "open" },
    ];

    const poller = createPoller({ stateFile });
    const fetchFn = makeFetchInterceptor(calls);
    const results = [];

    for (const item of items) {
      if (poller.isProcessed(item.id)) continue;

      const actionConfig = {
        path: "/proj",
        prompt: "review",
        worktree_name: "pr-{number}",
      };

      const result = await executeAction(item, actionConfig, {
        discoverServer: async () => serverUrl,
        fetch: fetchFn,
      });

      results.push({ item, result });

      if (result.success) {
        poller.markProcessed(item.id, {
          source: "test-prs",
          sessionId: result.sessionId,
          directory: result.directory,
        });
      }
    }

    // Both PRs should succeed
    assert.strictEqual(results.length, 2, "Both PRs should be processed");
    assert.ok(results[0].result.success, "PR #101 should succeed");
    assert.ok(results[1].result.success, "PR #102 should succeed");

    // Each PR must get its own session
    assert.strictEqual(
      calls.createdSessionIds?.length,
      2,
      "Two separate sessions must be created — one per PR"
    );
    assert.notStrictEqual(
      results[0].result.sessionId,
      results[1].result.sessionId,
      "Session IDs must differ between PRs"
    );

    // Both are now marked as processed
    assert.ok(poller.isProcessed("pr-101"), "PR #101 should be marked processed");
    assert.ok(poller.isProcessed("pr-102"), "PR #102 should be marked processed");
  });

  it("already-processed PR is skipped on second poll cycle", async () => {
    // One PR, processed in cycle 1. On cycle 2 it must be skipped.
    // This exercises the dedup path: poller.isProcessed() → continue.

    const calls = {};
    mockServer = await buildWorktreeMockServer(calls);
    const serverUrl = mockServer.url;

    const item = { id: "pr-200", number: 200, title: "PR #200", state: "open" };
    const poller = createPoller({ stateFile });
    const fetchFn = makeFetchInterceptor(calls);

    const actionConfig = {
      path: "/proj",
      prompt: "review",
      worktree_name: "pr-{number}",
    };

    // ── Cycle 1: process the PR ──────────────────────────────────────────
    const result1 = await executeAction(item, actionConfig, {
      discoverServer: async () => serverUrl,
      fetch: fetchFn,
    });

    assert.ok(result1.success, "Cycle 1: PR should be processed successfully");
    poller.markProcessed(item.id, {
      source: "test-prs",
      sessionId: result1.sessionId,
      directory: result1.directory,
    });

    const sessionsAfterCycle1 = calls.createdSessionIds?.length || 0;
    assert.strictEqual(sessionsAfterCycle1, 1, "Cycle 1: exactly one session created");

    // ── Cycle 2: same PR appears again — must be skipped ─────────────────
    let cycle2Executed = false;

    if (!poller.isProcessed(item.id)) {
      cycle2Executed = true;
      await executeAction(item, actionConfig, {
        discoverServer: async () => serverUrl,
        fetch: fetchFn,
      });
    }

    assert.strictEqual(cycle2Executed, false, "Cycle 2: PR must be skipped (already processed)");
    assert.strictEqual(
      calls.createdSessionIds?.length || 0,
      1,
      "Cycle 2: no new session must be created"
    );
  });
});
