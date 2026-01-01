# opencode-ntfy

ntfy notification plugin for [OpenCode](https://github.com/sst/opencode) with interactive permissions.

## Features

- **Idle notifications** - Get notified when OpenCode has been waiting for input for 5+ minutes
- **Interactive permissions** - Respond to permission requests directly from your phone via ntfy action buttons
- **Error & retry alerts** - Stay informed when something needs attention

## Installation

```bash
brew install athal7/tap/opencode-ntfy
```

Or install manually:

```bash
curl -fsSL https://raw.githubusercontent.com/athal7/opencode-ntfy/main/install.sh | bash
```

## Configuration

Configure in `~/.config/opencode/opencode.json` under the `ntfy` key:

```json
{
  "plugin": ["~/.config/opencode/plugins/opencode-ntfy"],
  "ntfy": {
    "topic": "your-secret-topic",
    "callbackHost": "your-machine.tailnet.ts.net"
  }
}
```

### Options

| Key | Default | Description |
|-----|---------|-------------|
| `topic` | *(required)* | Your ntfy topic name |
| `server` | `https://ntfy.sh` | ntfy server URL |
| `token` | *(none)* | ntfy access token for protected topics |
| `callbackHost` | *(none)* | Callback host for interactive notifications (required for interactive features) |
| `callbackPort` | `4097` | Callback server port |
| `idleDelayMs` | `300000` | Idle notification delay (5 min) |
| `errorNotify` | `true` | Enable error notifications |
| `errorDebounceMs` | `60000` | Error notification debounce window |
| `retryNotifyFirst` | `true` | Notify on first retry |
| `retryNotifyAfter` | `3` | Also notify after N retries (0 to disable) |

### Environment Variables

Environment variables override config file values. Use `NTFY_` prefix:

```bash
export NTFY_TOPIC=your-secret-topic
export NTFY_CALLBACK_HOST=your-machine.tailnet.ts.net
```

### Interactive Permissions

Interactive permission notifications require `callbackHost` to be configured AND the callback service to be running. Without these, only read-only notifications (idle, error, retry) are sent.

#### Starting the Callback Service

The callback service runs persistently to handle permission responses from ntfy. Start it with:

```bash
# Start the service
launchctl load ~/Library/LaunchAgents/io.opencode.ntfy.plist

# Check service status
launchctl list | grep opencode

# View logs
tail -f ~/.local/share/opencode-ntfy/opencode-ntfy.log

# Stop the service
launchctl unload ~/Library/LaunchAgents/io.opencode.ntfy.plist
```

#### Configuring Callback Access

For interactive notifications to work, your phone must be able to reach the callback server:

1. Set `callbackHost` to your machine's hostname accessible from your phone
2. For Tailscale users: use your Tailscale hostname (e.g., `macbook.tail1234.ts.net`)
3. Ensure port 4097 (or your configured `callbackPort`) is accessible
4. Start the callback service (see above)

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
