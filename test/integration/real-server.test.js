/**
 * Integration tests against a REAL OpenCode server.
 *
 * These tests verify actual API behavior — not mocked assumptions.
 * They require a running OpenCode instance (the desktop app) with access
 * to this repo's project. Tests are skipped when no server is available.
 *
 * What these tests prove:
 *
 *   1. Creating a session with a sandbox directory sets `session.directory`
 *      to the sandbox path AND resolves the correct `projectID` (same as
 *      the parent repo). This disproves the assumption that sandbox
 *      directories produce `projectID = 'global'`.
 *
 *   2. PATCH /session/:id does NOT change `session.directory`. The
 *      `?directory` query param on PATCH is a routing parameter only.
 *
 * These facts mean createSessionViaApi only needs to POST with the
 * working directory — no PATCH-based "re-scoping" is needed.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";

// ─── Server discovery ───────────────────────────────────────────────────────

const PROJECT_DIR = path.resolve(import.meta.dirname, "../..");
const SERVER_URL = "http://localhost:4096";
const SANDBOX_NAME = "test-real-server";

let serverAvailable = false;
let projectID = null;
let sandboxDir = null;
const createdSessionIds = [];

async function checkServer() {
  try {
    const encoded = encodeURIComponent(PROJECT_DIR);
    const res = await fetch(`${SERVER_URL}/session?directory=${encoded}`);
    if (!res.ok) return false;

    // Also verify this project is known
    const projRes = await fetch(`${SERVER_URL}/project`);
    if (!projRes.ok) return false;
    const projects = await projRes.json();
    const match = projects.find((p) => p.worktree === PROJECT_DIR);
    if (!match) return false;
    projectID = match.id;
    return true;
  } catch {
    return false;
  }
}

async function createSandbox() {
  const encoded = encodeURIComponent(PROJECT_DIR);
  const res = await fetch(
    `${SERVER_URL}/experimental/worktree?directory=${encoded}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: SANDBOX_NAME }),
    }
  );
  if (!res.ok) return null;
  const wt = await res.json();
  return wt.directory;
}

async function findOrCreateSandbox() {
  const encoded = encodeURIComponent(PROJECT_DIR);
  const res = await fetch(
    `${SERVER_URL}/experimental/worktree?directory=${encoded}`
  );
  if (res.ok) {
    const worktrees = await res.json();
    const existing = worktrees.find((w) => w.endsWith(`/${SANDBOX_NAME}`));
    if (existing) return existing;
  }
  return createSandbox();
}

async function archiveSession(id, directory) {
  const encoded = encodeURIComponent(directory);
  await fetch(`${SERVER_URL}/session/${id}?directory=${encoded}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: { archived: Date.now() } }),
  }).catch(() => {});
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("real server: session directory behavior", { skip: false }, () => {
  before(async () => {
    serverAvailable = await checkServer();
    if (!serverAvailable) return;
    sandboxDir = await findOrCreateSandbox();
  });

  after(async () => {
    if (!serverAvailable) return;
    // Archive test sessions so they don't clutter the UI
    for (const { id, directory } of createdSessionIds) {
      await archiveSession(id, directory);
    }
  });

  it("skip: no OpenCode server running", { skip: !false }, function () {
    // This is a sentinel — replaced dynamically in before()
  });

  it("POST /session with sandbox dir → correct directory AND projectID", async (t) => {
    if (!serverAvailable) return t.skip("no OpenCode server");
    if (!sandboxDir) return t.skip("could not create sandbox");

    const encoded = encodeURIComponent(sandboxDir);
    const res = await fetch(`${SERVER_URL}/session?directory=${encoded}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.ok(res.ok, `POST /session should succeed (got ${res.status})`);
    const session = await res.json();
    createdSessionIds.push({ id: session.id, directory: sandboxDir });

    // The session's directory must be the sandbox path — this is where the
    // agent will operate. This was the bug: prior code created with the
    // project dir, so the agent worked in the wrong directory.
    assert.strictEqual(
      session.directory,
      sandboxDir,
      "session.directory must be the sandbox path (where agent operates)"
    );

    // The projectID must match the parent repo's project — NOT 'global'.
    // This disproves the assumption that led to 4 regression-fix cycles.
    assert.strictEqual(
      session.projectID,
      projectID,
      "session.projectID must match the parent repo (sandbox is a git worktree of the same repo)"
    );
  });

  it("POST /session with project dir → project directory and same projectID", async (t) => {
    if (!serverAvailable) return t.skip("no OpenCode server");

    const encoded = encodeURIComponent(PROJECT_DIR);
    const res = await fetch(`${SERVER_URL}/session?directory=${encoded}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.ok(res.ok, `POST /session should succeed (got ${res.status})`);
    const session = await res.json();
    createdSessionIds.push({ id: session.id, directory: PROJECT_DIR });

    assert.strictEqual(
      session.directory,
      PROJECT_DIR,
      "session.directory must be the project path"
    );

    assert.strictEqual(
      session.projectID,
      projectID,
      "session.projectID must be the same whether created from sandbox or project dir"
    );
  });

  it("PATCH /session/:id does NOT change session.directory", async (t) => {
    if (!serverAvailable) return t.skip("no OpenCode server");
    if (!sandboxDir) return t.skip("could not create sandbox");

    // Create session with sandbox dir
    const encoded = encodeURIComponent(sandboxDir);
    const createRes = await fetch(
      `${SERVER_URL}/session?directory=${encoded}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const session = await createRes.json();
    createdSessionIds.push({ id: session.id, directory: sandboxDir });

    // PATCH with project dir (this is what the "re-scoping" code tried to do)
    const projectEncoded = encodeURIComponent(PROJECT_DIR);
    const patchRes = await fetch(
      `${SERVER_URL}/session/${session.id}?directory=${projectEncoded}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "patched-test" }),
      }
    );
    assert.ok(patchRes.ok, `PATCH should succeed (got ${patchRes.status})`);
    const patched = await patchRes.json();

    // The directory must NOT have changed — PATCH only updates title/archived
    assert.strictEqual(
      patched.directory,
      sandboxDir,
      "PATCH must NOT change session.directory (it only updates title/archived)"
    );

    // Title should have been updated
    assert.strictEqual(patched.title, "patched-test", "title should be updated");

    // Read it back to be sure
    const readRes = await fetch(
      `${SERVER_URL}/session?directory=${encoded}`
    );
    const sessions = await readRes.json();
    const readBack = sessions.find((s) => s.id === session.id);
    assert.ok(readBack, "session should be readable from sandbox dir");
    assert.strictEqual(
      readBack.directory,
      sandboxDir,
      "read-back confirms directory unchanged after PATCH"
    );
  });

  it("GET /session?directory filters by exact session.directory match", async (t) => {
    if (!serverAvailable) return t.skip("no OpenCode server");
    if (!sandboxDir) return t.skip("could not create sandbox");

    // Create session with sandbox dir
    const encoded = encodeURIComponent(sandboxDir);
    const createRes = await fetch(
      `${SERVER_URL}/session?directory=${encoded}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const session = await createRes.json();
    createdSessionIds.push({ id: session.id, directory: sandboxDir });

    // Query with sandbox dir — should find it (exact match on session.directory)
    const fromSandbox = await fetch(
      `${SERVER_URL}/session?directory=${encoded}`
    );
    const sandboxSessions = await fromSandbox.json();
    const foundFromSandbox = sandboxSessions.find((s) => s.id === session.id);
    assert.ok(
      foundFromSandbox,
      "session should be found when querying with sandbox dir (exact match)"
    );

    // Query with project dir — should NOT find it because session.directory
    // is the sandbox path, not the project path. The ?directory param on
    // GET /session is both a project-routing param (middleware) AND an exact
    // filter on session.directory (route handler). Since session.directory
    // is the sandbox path, it won't match the project path filter.
    // This is actually correct behavior: it means session reuse via
    // findReusableSession naturally isolates sandbox sessions from project
    // sessions — each sandbox only sees its own sessions.
    const projectEncoded = encodeURIComponent(PROJECT_DIR);
    const fromProject = await fetch(
      `${SERVER_URL}/session?directory=${projectEncoded}`
    );
    const projectSessions = await fromProject.json();
    const foundFromProject = projectSessions.find((s) => s.id === session.id);
    assert.ok(
      !foundFromProject,
      "session should NOT appear in project dir listing (directory filter is an exact match on session.directory)"
    );
  });
});
