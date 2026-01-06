# Agent Instructions

## Pre-Commit: Documentation Check

Before committing changes, verify documentation is updated to reflect code changes:

1. **README.md** - Update if changes affect:
   - Configuration options (config.yaml keys)
   - CLI commands (`opencode-pilot <command>`)
   - Installation or setup steps
   - Service management
   - Sources or polling behavior

2. **CONTRIBUTING.md** - Update if changes affect:
   - Development setup or workflow
   - Test commands or patterns

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

### 3. Restart Service

If the service is running, restart it:

```bash
# Stop current service (Ctrl+C) and restart
npx opencode-pilot start
```

### 4. Verify Upgrade

```bash
npx opencode-pilot status
```

## Configuration

Config file: `~/.config/opencode-pilot/config.yaml`

Configuration has these sections:
- `tools` - field mappings for MCP servers
- `sources` - polling sources with generic MCP tool references
- `repos` - per-repository settings (use YAML anchors to share config)

Template files: `~/.config/opencode-pilot/templates/*.md`

See [examples/config.yaml](examples/config.yaml) for a complete example.
