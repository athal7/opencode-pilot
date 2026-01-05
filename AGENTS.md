# Agent Instructions

## Pre-Commit: Documentation Check

Before committing changes, verify documentation is updated to reflect code changes:

1. **README.md** - Update if changes affect:
   - Configuration options (config.yaml keys)
   - CLI commands (`opencode-pilot <command>`)
   - Notification types or behavior
   - Installation or setup steps
   - Service management
   - Sources or polling behavior

2. **CONTRIBUTING.md** - Update if changes affect:
   - Development setup or workflow
   - Test commands or patterns
   - Plugin architecture

## Post-PR: Release and Upgrade Workflow

After a PR is merged to main, follow this workflow to upgrade the local installation:

### 1. Watch CI Run

Watch the CI workflow until it completes (creates release via semantic-release and publishes to npm):

```bash
gh run watch -R athal7/opencode-pilot
```

### 2. Verify Release Created

Confirm the new release was published:

```bash
gh release list -R athal7/opencode-pilot -L 1
npm view opencode-pilot version
```

### 3. Restart OpenCode

OpenCode auto-updates npm plugins. Simply restart any running OpenCode sessions to get the latest version.

### 4. Restart Service

If the callback service is running, restart it:

```bash
# Stop current service (Ctrl+C) and restart
npx opencode-pilot start
```

### 5. Verify Upgrade

```bash
npx opencode-pilot status
```

## Configuration

Config file: `~/.config/opencode-pilot/config.yaml`

Configuration has three sections:
- `notifications` - ntfy settings (topic, server, callback, etc.)
- `repos` - per-repository settings (use YAML anchors to share config)
- `sources` - polling sources with generic MCP tool references

Template files: `~/.config/opencode-pilot/templates/*.md`

See [examples/config.yaml](examples/config.yaml) for a complete example.
