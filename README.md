# opencode-pilot

Automation layer for [OpenCode](https://github.com/sst/opencode) - notifications, mobile UI, and workflow orchestration.

> **Version 0.x** - Pre-1.0 software. Minor versions may contain breaking changes.

## Features

- **Idle notifications** - Get notified when OpenCode has been waiting for input
- **Mobile UI** - View sessions and respond from your phone via ntfy action buttons
- **Interactive permissions** - Approve/reject permission requests from anywhere
- **Error & retry alerts** - Stay informed when something needs attention

## Installation

```bash
brew install athal7/tap/opencode-pilot

# Start the notification service
brew services start opencode-pilot
```

## Quick Start

1. **Run setup** to configure the plugin:

   ```bash
   opencode-pilot setup
   ```

2. **Create config** at `~/.config/opencode-pilot/config.json`:

   ```json
   {
     "topic": "your-secret-topic",
     "callbackHost": "your-machine.tailnet.ts.net"
   }
   ```

3. **Start the service**:

   ```bash
   brew services start opencode-pilot
   ```

4. **Run OpenCode** - notifications will be sent to your ntfy topic!

## Configuration

Create `~/.config/opencode-pilot/config.json`:

```json
{
  "topic": "your-secret-topic",
  "server": "https://ntfy.sh",
  "token": "tk_xxx",
  "callbackHost": "your-machine.tailnet.ts.net",
  "callbackPort": 4097,
  "idleDelayMs": 300000
}
```

### Options

| Key | Default | Description |
|-----|---------|-------------|
| `topic` | *(required)* | Your ntfy topic name |
| `server` | `https://ntfy.sh` | ntfy server URL |
| `token` | *(none)* | ntfy access token for protected topics |
| `callbackHost` | *(none)* | Hostname for callbacks (e.g., Tailscale hostname) |
| `callbackPort` | `4097` | Callback service port |
| `callbackHttps` | `false` | Use HTTPS via Tailscale Serve |
| `idleDelayMs` | `300000` | Idle notification delay (default: 5 minutes) |

### Environment Variables

Environment variables override config file values:

| Variable | Config Key |
|----------|------------|
| `NTFY_TOPIC` | `topic` |
| `NTFY_SERVER` | `server` |
| `NTFY_TOKEN` | `token` |
| `NTFY_CALLBACK_HOST` | `callbackHost` |
| `NTFY_CALLBACK_PORT` | `callbackPort` |

## Service Management

```bash
# Start the service (runs at login)
brew services start opencode-pilot

# Check status
brew services info opencode-pilot

# View logs
tail -f $(brew --prefix)/var/log/opencode-pilot.log

# Stop the service
brew services stop opencode-pilot
```

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

## Network Requirements

The callback service listens on port 4097 (configurable). For remote access:

1. Your phone must reach the callback host on the callback port
2. **Tailscale users**: Use your machine's Tailscale hostname (e.g., `macbook.tail1234.ts.net`)

### HTTPS with Tailscale Serve (Recommended)

For better iOS Safari compatibility:

```bash
tailscale serve --bg 4097
```

Then set `"callbackHttps": true` in your config.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  OpenCode   │────▶│    Plugin    │────▶│  ntfy.sh    │
│ (localhost) │     │  (in-proc)   │     │  (cloud)    │
└─────────────┘     └──────────────┘     └─────────────┘
       ▲                   │                    │
       │                   ▼                    ▼
       │            ┌──────────────┐     ┌─────────────┐
       └────────────│   Service    │◀────│   Phone     │
                    │   :4097      │     │ (ntfy app)  │
                    └──────────────┘     └─────────────┘
```

## Troubleshooting

### Notifications not arriving

1. Check ntfy topic: `curl -d "test" ntfy.sh/your-topic`
2. Verify config: `cat ~/.config/opencode-pilot/config.json | jq .`
3. Check plugin is loaded in OpenCode

### Permission buttons not working

1. Ensure service is running: `brew services info opencode-pilot`
2. Verify `callbackHost` is reachable from your phone
3. Check service logs for errors

## Related

- [opencode-devcontainers](https://github.com/athal7/opencode-devcontainers) - Run multiple devcontainer instances for OpenCode

## License

MIT
