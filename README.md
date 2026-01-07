# opencode-pilot

Automation daemon for [OpenCode](https://github.com/sst/opencode) - polls for work and spawns sessions.

> **Note**: This is a community project and is not built by or affiliated with the OpenCode team.

## Features

- **Polling automation** - Automatically start sessions from GitHub issues, Linear tickets, etc.
- **Readiness evaluation** - Check labels, dependencies, and priority before starting work
- **Template-based prompts** - Customize prompts with placeholders for issue data
- **Built-in presets** - Common patterns like "my GitHub issues" work out of the box

## Installation

```bash
npm install -g opencode-pilot
```

## Quick Start

1. **Create config** - Copy [examples/config.yaml](examples/config.yaml) to `~/.config/opencode-pilot/config.yaml` and customize

2. **Create templates** - Add prompt templates to `~/.config/opencode-pilot/templates/`

3. **Enable the plugin** - Add to your `opencode.json`:

   ```json
   {
     "plugin": ["opencode-pilot"]
   }
   ```

   The daemon will auto-start when OpenCode launches.

   Or start manually:

   ```bash
   opencode-pilot start
   ```

## Configuration

See [examples/config.yaml](examples/config.yaml) for a complete example with all options.

### Source Syntax Options

Three ways to configure sources, from simplest to most flexible:

#### 1. Presets (recommended)

Built-in presets for common patterns:

```yaml
sources:
  - preset: github/my-issues
    prompt: worktree

  - preset: github/review-requests
    prompt: review

  - preset: linear/my-issues
    args:
      teamId: "your-team-uuid"
      assigneeId: "your-user-uuid"
```

**Available presets:**
- `github/my-issues` - Issues assigned to me
- `github/review-requests` - PRs needing my review
- `github/my-prs-feedback` - My PRs with change requests
- `linear/my-issues` - Linear tickets (requires `teamId`, `assigneeId`)

#### 2. GitHub Shorthand

For custom GitHub queries:

```yaml
sources:
  - name: urgent-issues
    github: "is:issue assignee:@me label:urgent state:open"
    prompt: worktree
```

#### 3. Full Syntax

For non-GitHub sources or complete control:

```yaml
sources:
  - name: agent-tasks
    tool:
      mcp: apple-reminders
      name: list_reminders
    args:
      list_name: "Agent Tasks"
    item:
      id: "reminder:{id}"
    prompt: agent-planning
```

### Defaults

Apply settings to all sources:

```yaml
defaults:
  agent: plan
  prompt: default

sources:
  - preset: github/my-issues      # Gets agent: plan, prompt: default
  - preset: github/review-requests
    prompt: review                # Overrides default prompt
```

### Key Sections

- **`defaults`** - Default values applied to all sources
- **`sources`** - What to poll (presets, shorthand, or full config)
- **`tools`** - Field mappings to normalize different MCP APIs
- **`repos`** - Repository paths and settings (use YAML anchors to share config)

### Prompt Templates

Create prompt templates as markdown files in `~/.config/opencode-pilot/templates/`. Templates support placeholders like `{title}`, `{body}`, `{number}`, `{html_url}`, etc.

## CLI Commands

```bash
opencode-pilot start              # Start the service (foreground)
opencode-pilot status             # Check status
opencode-pilot config             # Validate and show config
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
