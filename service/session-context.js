/**
 * session-context.js - SessionContext value object
 *
 * Encapsulates the two-directory problem that repeatedly caused session
 * creation regressions (v0.24.7 through v0.24.10).
 *
 * ## The Problem
 *
 * OpenCode's POST /session API accepts a single `directory` parameter that
 * conflates two distinct concerns:
 *
 *   1. **Project scoping** (projectID) — which project the session belongs to
 *      in the desktop UI. Requires the *project directory* (the main git repo).
 *
 *   2. **Working directory** — where the agent executes file operations.
 *      Requires the *worktree directory* when using git worktrees.
 *
 * When a worktree is active, these directories differ. Passing the wrong one
 * satisfies one requirement but silently breaks the other.
 *
 * ## The Three Invariants
 *
 * Any correct session creation MUST satisfy all three:
 *
 *   A. **Project scoping**: Session's projectID matches the project (not
 *      'global'). The session is visible in the desktop app.
 *      → Requires POST /session?directory=<projectDirectory>
 *
 *   B. **Working directory**: Agent operates in the correct location.
 *      In worktree mode the session's working dir must be the worktree path,
 *      so file reads/writes go to the right branch.
 *      → Requires per-message directory=<workingDirectory>
 *        (or PATCH /session/:id to update the session working dir)
 *
 *   C. **Session isolation**: Session reuse only finds sessions for the
 *      *same work item* (same PR/issue), not other PRs sharing the project.
 *      → Worktree sessions must NOT be reused across items; each PR gets
 *        its own session.
 *
 * ## The Solution
 *
 * - Create sessions with `projectDirectory` (satisfies A).
 * - Send messages with `workingDirectory` (satisfies B).
 * - Skip `findReusableSession` entirely when in a worktree (satisfies C),
 *   because neither the worktree path nor the project path can safely scope
 *   reuse to a single PR.
 *
 * ## Worktree Detection
 *
 * A session is "in a worktree" when `workingDirectory !== projectDirectory`.
 * Non-worktree sessions have both set to the same value.
 */

export class SessionContext {
  /**
   * @param {string} projectDirectory - Base git repo path. Used for:
   *   - POST /session?directory=... (sets projectID for UI visibility)
   *   - PATCH /session/:id?directory=... (if post-creation re-scoping needed)
   *   - listSessions query (for session reuse lookup in non-worktree mode)
   *
   * @param {string} workingDirectory - Directory where the agent does work. Used for:
   *   - POST /session/:id/message?directory=... (file operations)
   *   - POST /session/:id/command?directory=... (slash commands)
   *   Equals projectDirectory when not using worktrees.
   */
  constructor(projectDirectory, workingDirectory) {
    if (!projectDirectory) throw new Error('SessionContext: projectDirectory is required');
    if (!workingDirectory) throw new Error('SessionContext: workingDirectory is required');
    this.projectDirectory = projectDirectory;
    this.workingDirectory = workingDirectory;
    Object.freeze(this);
  }

  /**
   * True when the session runs in a worktree separate from the main repo.
   * Worktree sessions must NOT participate in findReusableSession (invariant C):
   * - Querying by workingDirectory finds old sessions scoped to 'global' (wrong projectID)
   * - Querying by projectDirectory finds sessions for other PRs in the same project
   */
  get isWorktree() {
    return this.projectDirectory !== this.workingDirectory;
  }

  /**
   * Factory: use this when there is no worktree (single-directory case).
   */
  static forProject(directory) {
    return new SessionContext(directory, directory);
  }

  /**
   * Factory: use this when a worktree has been resolved.
   */
  static forWorktree(projectDirectory, worktreeDirectory) {
    return new SessionContext(projectDirectory, worktreeDirectory);
  }
}
