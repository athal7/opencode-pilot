# opencode-pilot

Automation layer for [OpenCode](https://github.com/sst/opencode) - notifications and workflow orchestration.

## Features

- **Idle notifications** - Get notified when OpenCode has been waiting for input
- **Error alerts** - Stay informed when something needs attention
- **Polling automation** - Automatically start sessions from GitHub issues, Linear tickets, etc.

## Installation

Add the plugin to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-pilot"]
}
```

OpenCode auto-installs npm plugins on startup.

## Quick Start

1. **Create config** - Copy [examples/config.yaml](examples/config.yaml) to `~/.config/opencode-pilot/config.yaml` and customize

2. **Start the service** (in a separate terminal):

   ```bash
   npx opencode-pilot start
   ```

3. **Run OpenCode** - notifications will be sent to your ntfy topic!

## Configuration

See [examples/config.yaml](examples/config.yaml) for a complete example with all options.

### Key Sections

- **`notifications`** - ntfy settings (topic, server, idle/error settings)
- **`repos`** - Repository paths and settings (use YAML anchors to share config)
- **`sources`** - What to poll (GitHub issues, Linear tickets, etc.)
- **`tools`** - Field mappings to normalize different MCP APIs

### Prompt Templates

Create prompt templates as markdown files in `~/.config/opencode-pilot/templates/`. Templates support placeholders like `{title}`, `{body}`, `{number}`, `{html_url}`, etc.

## Service Management

```bash
npx opencode-pilot start              # Start the service (foreground)
npx opencode-pilot status             # Check status
npx opencode-pilot test-source NAME   # Test a source
```

For persistent service management, consider using your system's service manager (launchd on macOS, systemd on Linux).

## Features in Detail

### Idle Notifications

When OpenCode goes idle (waiting for input), you'll receive a notification with an **Open Session** button that opens a mobile-friendly UI to view and respond.

### Interactive Permissions

Permission requests show action buttons:
- **Allow Once** - Approve this specific request
- **Allow Always** - Approve and remember for this tool
- **Reject** - Deny the request

### Agent & Model Selection

The mobile UI supports selecting different agents and models when responding to sessions, giving you the same flexibility as the desktop interface.

### Bot Identity for Autonomous Actions

When polling triggers automated sessions, you can configure a GitHub App identity so actions are attributed to a bot account instead of your personal GitHub identity.

**Setting up a GitHub App:**

1. Create a GitHub App in your account settings:
   - Go to Settings → Developer settings → GitHub Apps → New GitHub App
   - Set permissions: `Contents: Read & write`, `Issues: Read & write`, `Pull requests: Read & write`
   - Generate a private key and download it

2. Install the app on your repos

3. Add `identity` configuration to your `config.yaml` - see [examples/config.yaml](examples/config.yaml) for the full schema

The bot identity is injected via environment variables (`GH_TOKEN`, `GIT_AUTHOR_NAME`, etc.) when sessions are started autonomously.

## Troubleshooting

1. Check ntfy topic: `curl -d "test" ntfy.sh/your-topic`
2. Verify config: `npx opencode-pilot config`
3. Enable debug logging: set `notifications.debug: true` in config

## Related

- [opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) - Run multiple devcontainer instances for OpenCode

## License

MIT
