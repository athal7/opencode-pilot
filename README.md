# opencode-ntfy

ntfy notification plugin for [OpenCode](https://github.com/sst/opencode) with interactive permissions.

## Features

- **Idle notifications** - Get notified when OpenCode has been waiting for input for 5+ minutes
- **Interactive permissions** - Respond to permission requests directly from your phone via ntfy action buttons
- **Error & retry alerts** - Stay informed when something needs attention
- **Tailscale-friendly** - Automatic hostname discovery for callback URLs

## Installation

```bash
brew install athal7/tap/opencode-ntfy
```

Or install manually:

```bash
curl -fsSL https://raw.githubusercontent.com/athal7/opencode-ntfy/main/install.sh | bash
```

## Configuration

### Required

Set your ntfy topic in `~/.env` (loaded by direnv):

```bash
NTFY_TOPIC=your-secret-topic
```

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `NTFY_SERVER` | `https://ntfy.sh` | ntfy server URL |
| `NTFY_TOKEN` | *(none)* | ntfy access token for protected topics |
| `NTFY_CALLBACK_HOST` | *(auto-discover)* | Callback host for interactive notifications |
| `NTFY_CALLBACK_PORT` | `4097` | Callback server port |
| `NTFY_IDLE_DELAY_MS` | `300000` | Idle notification delay (5 min) |
| `NTFY_ERROR_NOTIFY` | `true` | Enable error notifications |
| `NTFY_ERROR_DEBOUNCE_MS` | `60000` | Error notification debounce window |
| `NTFY_RETRY_NOTIFY_FIRST` | `true` | Notify on first retry |
| `NTFY_RETRY_NOTIFY_AFTER` | `3` | Also notify after N retries (0 to disable) |

### Interactive Permissions

For interactive permission notifications to work, your phone must be able to reach the callback server. If you're using Tailscale:

1. Ensure both your computer and phone are on the same Tailscale network
2. The plugin will automatically discover your Tailscale hostname
3. Or set `NTFY_CALLBACK_HOST` explicitly to your Tailscale hostname

## Notifications

| Event | Type | Interactive |
|-------|------|-------------|
| Permission request | Immediate | Yes (Allow Once / Allow Always / Reject) |
| Session idle (5min) | Delayed | No |
| Retry | Immediate | No |
| Error | Debounced | No |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## License

MIT
