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

1. **Create config** - Copy [examples/config.yaml](examples/config.yaml) to `~/.config/opencode/pilot/config.yaml` and customize

2. **Create templates** - Add prompt templates to `~/.config/opencode/pilot/templates/`

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

### Key Sections

- **`server_port`** - Preferred OpenCode server port (e.g., `4096`). When multiple OpenCode instances are running, pilot attaches sessions to this port.
- **`defaults`** - Default values applied to all sources
- **`sources`** - What to poll (presets, shorthand, or full config)
- **`tools`** - Field mappings to normalize different MCP APIs
- **`repos`** - Repository paths and settings (use YAML anchors to share config)

### Source Syntax

Three ways to configure sources, from simplest to most flexible:

1. **Presets** - Built-in definitions for common patterns (`github/my-issues`, `github/review-requests`, etc.)
2. **GitHub shorthand** - Simple `github: "query"` syntax for custom GitHub searches
3. **Full syntax** - Complete control with `tool`, `args`, and `item` for any MCP source

### Available Presets

- `github/my-issues` - Issues assigned to me
- `github/review-requests` - PRs needing my review
- `github/my-prs-feedback` - My PRs with change requests
- `linear/my-issues` - Linear tickets (requires `teamId`, `assigneeId`)

### Prompt Templates

Create prompt templates as markdown files in `~/.config/opencode/pilot/templates/`. Templates support placeholders like `{title}`, `{body}`, `{number}`, `{html_url}`, etc.

## CLI Commands

```bash
opencode-pilot start              # Start the service (foreground)
opencode-pilot status             # Check status
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

## Known Issues

None currently! Previous issues have been resolved:

- ~~Sessions attached to global server run in wrong directory~~ - Fixed in v0.14.0 by using the HTTP API with `?directory=` parameter instead of `opencode run --attach`

## Related

- [opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) - Run multiple devcontainer instances for OpenCode

## License

MIT
