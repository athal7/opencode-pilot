# opencode-pilot

Automation daemon for [OpenCode](https://github.com/sst/opencode) - polls for work and spawns sessions.

> **Note**: This is a community project and is not built by or affiliated with the OpenCode team.

## Features

- **Polling automation** - Automatically start sessions from GitHub issues, Linear tickets, etc.
- **Readiness evaluation** - Check labels, dependencies, and priority before starting work
- **Template-based prompts** - Customize prompts with placeholders for issue data
- **Built-in presets** - Common patterns like "my GitHub issues" work out of the box

## Installation

### Homebrew (recommended)

```bash
brew tap athal7/opencode-pilot
brew install opencode-pilot

# Start the service (runs at login)
brew services start opencode-pilot
```

Upgrade with `brew upgrade opencode-pilot`.

### npm (alternative)

```bash
npm install -g opencode-pilot
opencode-pilot start
```

## Quick Start

1. **Create config** - Copy [examples/config.yaml](examples/config.yaml) to `~/.config/opencode/pilot/config.yaml` and customize

2. **Create templates** - Add prompt templates to `~/.config/opencode/pilot/templates/`

3. **Start the service**:

   ```bash
   # If installed via Homebrew:
   brew services start opencode-pilot

   # If installed via npm:
   opencode-pilot start
   ```

## Configuration

See [examples/config.yaml](examples/config.yaml) for a complete example with all options.

### Key Sections

- **`server_port`** - Preferred OpenCode server port (e.g., `4096`). When multiple OpenCode instances are running, pilot attaches sessions to this port.
- **`startup_delay`** - Milliseconds to wait before first poll (default: `10000`). Allows OpenCode server time to fully initialize after restart.
- **`repos_dir`** - Directory containing git repos (e.g., `~/code`). Pilot auto-discovers repos by scanning git remotes (both `origin` and `upstream` for fork support).
- **`defaults`** - Default values applied to all sources (`agent`, `model`, `prompt`, etc.)
- **`sources`** - What to poll (presets, shorthand, or full config)
- **`tools`** - Field mappings to normalize different MCP APIs
- **`repos`** - Explicit repository paths (overrides auto-discovery from `repos_dir`)

### Source Syntax

Three ways to configure sources, from simplest to most flexible:

1. **Presets** - Built-in definitions for common patterns (`github/my-issues`, `github/review-requests`, etc.)
2. **GitHub shorthand** - Simple `github: "query"` syntax for custom GitHub searches
3. **Full syntax** - Complete control with `tool`, `args`, and `item` for any MCP source

### Available Presets

- `github/my-issues` - Issues assigned to me
- `github/review-requests` - PRs needing my review
- `github/my-prs-attention` - My PRs needing attention (conflicts OR human feedback)
- `linear/my-issues` - Linear tickets (requires `teamId`, `assigneeId`)

Session names for `my-prs-attention` indicate the condition: "Conflicts: {title}", "Feedback: {title}", or "Conflicts+Feedback: {title}".

### Prompt Templates

Create prompt templates as markdown files in `~/.config/opencode/pilot/templates/`. Templates support placeholders like `{title}`, `{body}`, `{number}`, `{html_url}`, etc.

### Model Selection

Override the default model used by the agent for pilot sessions. This avoids creating a separate agent just to use a different model.

```yaml
defaults:
  agent: plan
  model: anthropic/claude-sonnet-4-20250514  # Applied to all sources

sources:
  - preset: github/review-requests
    model: anthropic/claude-haiku-3.5  # Override for this source only
```

Format: `provider/model-id` (e.g., `anthropic/claude-sonnet-4-20250514`). If no provider prefix, defaults to `anthropic`.

Priority: source `model` > defaults `model` > agent's built-in default.

### Session and Sandbox Reuse

By default, pilot reuses existing sessions and sandboxes to avoid duplicates:

- **Session reuse**: If a non-archived session already exists for the target directory, pilot appends to it instead of creating a new session. Archived sessions are never reused.
- **Sandbox reuse**: When `worktree: "new"` with a `worktree_name`, pilot first checks if a sandbox with that name already exists and reuses it.

```yaml
defaults:
  # Disable session reuse (always create new sessions)
  reuse_active_session: false
  # Disable sandbox reuse (always create new worktrees)
  prefer_existing_sandbox: false
```

When multiple sessions exist for the same directory, pilot prefers idle sessions over busy ones, then selects the most recently updated.

### Worktree Support

Run sessions in isolated git worktrees instead of the main project directory. This uses OpenCode's built-in worktree management API to create and manage worktrees.

```yaml
sources:
  - preset: github/my-issues
    # Create a fresh worktree for each session (or reuse if name matches)
    worktree: "new"
    worktree_name: "issue-{number}"  # Optional: name template
    
  - preset: linear/my-issues
    # Use an existing worktree by name
    worktree: "my-feature-branch"
```

**Options:**
- `worktree: "new"` - Create a new worktree via OpenCode's API (or reuse existing if name matches)
- `worktree: "name"` - Look up existing worktree by name from project sandboxes
- `worktree_name` - Template for naming new worktrees (only with `worktree: "new"`)
- `prefer_existing_sandbox: false` - Disable sandbox reuse for this source

## CLI Commands

```bash
opencode-pilot start              # Start the service (foreground)
opencode-pilot stop               # Stop the running service
opencode-pilot status             # Show version and service status
opencode-pilot config             # Validate and show config
opencode-pilot clear              # Show state summary
opencode-pilot clear --all        # Clear all processed state
opencode-pilot clear --expired    # Clear expired entries (uses configured TTL)
opencode-pilot clear --source X   # Clear entries for source X
opencode-pilot clear --item ID    # Clear specific item
opencode-pilot test-source NAME   # Test a source
opencode-pilot test-mapping MCP   # Test field mappings
```

## How It Works

1. **Poll sources** - Periodically fetch items from configured MCP tools (GitHub, Linear, etc.)
2. **Evaluate readiness** - Check labels, dependencies, and calculate priority
3. **Spawn sessions** - Start `opencode run` with the appropriate prompt template
4. **Track state** - Remember which items have been processed

## Related

- [opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) - Run multiple devcontainer instances for OpenCode

## License

MIT
