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

### 3. Upgrade via Homebrew

```bash
brew upgrade opencode-pilot
```

### 4. Restart Service

If the service is running, restart it:

```bash
# Stop current service (Ctrl+C) and restart
opencode-pilot start
```

### 5. Verify Upgrade

```bash
opencode-pilot status
```

## Configuration

Config file: `~/.config/opencode/pilot/config.yaml`

Configuration has these sections:
- `defaults` - default values applied to all sources
- `repos_dir` - directory to auto-discover repos via git remotes
- `sources` - polling sources with presets, shorthand, or full MCP tool config
- `tools` - field mappings to normalize different MCP APIs

Template files: `~/.config/opencode/pilot/templates/*.md`

See [examples/config.yaml](examples/config.yaml) for a complete example.
