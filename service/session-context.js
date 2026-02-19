/**
 * session-context.js - SessionContext value object
 *
 * Tracks both the project directory (main git repo) and the working directory
 * (which may be a sandbox/worktree) for session creation.
 *
 * ## How OpenCode's API actually works
 *
 * Verified against a real OpenCode server (see test/integration/real-server.test.js):
 *
 *   - POST /session?directory=X sets `session.directory = X` and derives
 *     `session.projectID` from the git root of X. Sandbox directories are
 *     git worktrees that share the same root commit as the parent repo, so
 *     they get the correct projectID automatically. There is NO need to
 *     create with the project directory for "project scoping".
 *
 *   - PATCH /session/:id only updates title/archived. The ?directory param
 *     is a routing parameter (determines which project to look in), NOT a
 *     mutation of session.directory.
 *
 *   - GET /session?directory=X uses ?directory for both project routing
 *     (middleware) and as an exact filter on session.directory (route handler).
 *     This means sessions created with a sandbox dir are only visible when
 *     querying with that sandbox dir — natural isolation per worktree.
 *
 * ## Why SessionContext still carries both directories
 *
 * Even though createSessionViaApi only needs workingDirectory, the project
 * directory is still needed for:
 *   - Worktree detection (isWorktree) — to skip session reuse for sandbox
 *     sessions and prevent cross-PR contamination
 *   - resolveWorktreeDirectory — needs the base project dir to create/list
 *     worktrees via GET/POST /experimental/worktree?directory=<projectDir>
 *
 * ## Worktree Detection
 *
 * A session is "in a worktree" when `workingDirectory !== projectDirectory`.
 * Non-worktree sessions have both set to the same value.
 */

export class SessionContext {
  /**
   * @param {string} projectDirectory - Base git repo path. Used for:
   *   - Worktree detection (isWorktree check for session isolation)
   *   - Worktree API calls (GET/POST /experimental/worktree?directory=...)
   *
   * @param {string} workingDirectory - Directory where the agent does work. Used for:
   *   - POST /session?directory=... (sets session.directory AND projectID)
   *   - POST /session/:id/message?directory=... (file operations)
   *   - PATCH /session/:id?directory=... (routing for title updates)
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
   * Worktree sessions skip findReusableSession to prevent cross-PR
   * contamination — each PR/issue in its own sandbox gets its own session.
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
