# opencode-ntfy

ntfy notification plugin for [OpenCode](https://github.com/sst/opencode) with interactive permissions.

## Features

- **Idle notifications** - Get notified when OpenCode has been waiting for input, with an "Open Session" button to view and reply
- **Interactive permissions** - Respond to permission requests directly from your phone via ntfy action buttons
- **Error & retry alerts** - Stay informed when something needs attention
- **New session page** - Start new OpenCode sessions from your phone with project, model, and agent selection

## Installation

```bash
brew install athal7/tap/opencode-ntfy
```

Or install manually:

```bash
curl -fsSL https://raw.githubusercontent.com/athal7/opencode-ntfy/main/install.sh | bash
```

## Quick Start

1. **Add the plugin** to `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["~/.config/opencode/plugins/opencode-ntfy"]
   }
   ```

2. **Create config** at `~/.config/opencode-ntfy/config.json`:

   ```json
   {
     "topic": "your-secret-topic",
     "callbackHost": "your-machine.tailnet.ts.net"
   }
   ```

3. **Start the callback service**:

   ```bash
   brew services start opencode-ntfy
   ```

4. **Run OpenCode** - notifications will be sent to your ntfy topic!

## Configuration

### Config File

Create `~/.config/opencode-ntfy/config.json`:

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
| `callbackHost` | *(none)* | Hostname for callbacks and proxy (e.g., Tailscale hostname) |
| `callbackPort` | `4097` | Callback service port |
| `callbackHttps` | `false` | Use HTTPS via Tailscale Serve (recommended) |
| `idleDelayMs` | `300000` | Idle notification delay in ms (default: 5 minutes) |
| `idleNotify` | `true` | Enable idle notifications |
| `errorNotify` | `true` | Enable error notifications |
| `errorDebounceMs` | `60000` | Minimum time between error notifications |
| `retryNotifyFirst` | `true` | Notify on first retry |
| `retryNotifyAfter` | `3` | Also notify after N retries (0 to disable) |

### Environment Variables

Environment variables override config file values:

| Environment Variable | Config Key |
|---------------------|------------|
| `NTFY_TOPIC` | `topic` |
| `NTFY_SERVER` | `server` |
| `NTFY_TOKEN` | `token` |
| `NTFY_CALLBACK_HOST` | `callbackHost` |
| `NTFY_CALLBACK_PORT` | `callbackPort` |
| `NTFY_CALLBACK_HTTPS` | `callbackHttps` |
| `NTFY_IDLE_DELAY_MS` | `idleDelayMs` |
| `NTFY_IDLE_NOTIFY` | `idleNotify` |
| `NTFY_ERROR_NOTIFY` | `errorNotify` |
| `NTFY_ERROR_DEBOUNCE_MS` | `errorDebounceMs` |
| `NTFY_RETRY_NOTIFY_FIRST` | `retryNotifyFirst` |
| `NTFY_RETRY_NOTIFY_AFTER` | `retryNotifyAfter` |

## Callback Service

The callback service is a persistent background process that receives permission responses from ntfy action buttons and forwards them to OpenCode.

### Starting the Service

**Homebrew (recommended):**

```bash
# Start the service (runs at login)
brew services start opencode-ntfy

# Check status
brew services info opencode-ntfy

# View logs
tail -f ~/Library/Logs/Homebrew/opencode-ntfy.log

# Stop the service
brew services stop opencode-ntfy
```

**Manual installation:**

```bash
# Start
launchctl load ~/Library/LaunchAgents/io.opencode.ntfy.plist

# Check status
launchctl list | grep opencode

# View logs
tail -f ~/.local/share/opencode-ntfy/opencode-ntfy.log

# Stop
launchctl unload ~/Library/LaunchAgents/io.opencode.ntfy.plist
```

### Network Requirements

The callback service listens on port 4097 (configurable). For remote access:

1. Your phone must be able to reach the callback host on the callback port
2. **Tailscale users**: Use your machine's Tailscale hostname (e.g., `macbook.tail1234.ts.net`)
3. Ensure the port is not blocked by firewalls

### HTTPS with Tailscale Serve (Recommended)

For better iOS Safari compatibility, use Tailscale Serve to add HTTPS:

```bash
# Enable Tailscale Serve (one-time setup, persists across reboots)
tailscale serve --bg 4097
```

Then add to your config:

```json
{
  "callbackHttps": true
}
```

This uses Tailscale's automatic Let's Encrypt certificates. Your service remains HTTP locally, but is accessible via HTTPS at `https://your-machine.tailnet.ts.net/`.

**Note:** This only exposes to your tailnet (your devices), NOT the public internet. Tailscale Funnel (which does expose publicly) is NOT used.

## Features in Detail

### Idle Notifications with Open Session

When OpenCode goes idle (waiting for input), you'll receive a notification with an **Open Session** button. Tapping it opens a **mobile-friendly session UI** that shows the last agent message and lets you send replies.

**Requirements for Open Session:**
- Callback service must be running: `brew services start opencode-ntfy`
- Your phone must be on the same Tailscale network
- `callbackHost` must be set to your Tailscale hostname

The mobile UI is served by the callback service and proxies requests to OpenCode, so OpenCode doesn't need to be exposed directly.

### New Session Page

Start new OpenCode sessions from your phone by bookmarking:

```
http://{callbackHost}:{callbackPort}/new
```

The new session page includes:
- **Project selector** - Choose from available OpenCode projects
- **Agent selector** - Pick which agent to use (build, plan, etc.)
- **Message input** - Type your initial prompt

After starting a session, you'll receive an idle notification when OpenCode is ready for more input.

**Requirements:**
- Callback service must be running
- OpenCode must be running (the page proxies to it)
- Your phone must be on the same Tailscale network

**URL Options:**
- `/new` - Uses default port 4096
- `/new?port=4096` - Specify OpenCode port explicitly
- `/new/4096` - Alternative port-specific URL

### Interactive Permissions

Permission requests show three action buttons:
- **Allow Once** - Approve this specific request
- **Allow Always** - Approve and remember for this tool
- **Reject** - Deny the request

Requires `callbackHost` to be configured and the callback service running.

### Error & Retry Notifications

- **Errors**: Sent immediately (debounced to prevent spam)
- **Retries**: Configurable - notify on first retry and/or after N retries

## Notification Types

| Event | Timing | Interactive | Actions |
|-------|--------|-------------|---------|
| Permission request | Immediate | Yes | Allow Once / Allow Always / Reject |
| Session idle | After delay | Partial | Open Session button |
| Retry | Immediate | No | - |
| Error | Debounced | No | - |

## Troubleshooting

### Notifications not arriving

1. Check ntfy topic is correct: `curl -d "test" ntfy.sh/your-topic`
2. Verify config file syntax: `cat ~/.config/opencode-ntfy/config.json | jq .`
3. Check plugin is loaded in OpenCode logs

### Permission buttons not working

1. Ensure callback service is running: `brew services info opencode-ntfy`
2. Verify `callbackHost` is reachable from your phone
3. Check callback service logs for errors

### Open Session button not working

1. Ensure callback service is running: `brew services info opencode-ntfy`
2. Verify you can reach `http://{callbackHost}:{callbackPort}/health` from your phone
3. Check that OpenCode is running (the callback service proxies to it)

### iOS prompts to "Show IP Address" repeatedly (iCloud Private Relay)

If you're using iCloud Private Relay and Safari keeps asking whether to show your IP address to your Tailscale domain, this is Safari's privacy feature—not an opencode-ntfy authentication issue.

**Solution:** Reduce privacy protections for your Tailscale hostname. See Apple's guide: [Manage iCloud Private Relay for specific websites](https://support.apple.com/en-us/102022). This only affects that domain and preserves Private Relay for all other sites.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  OpenCode   │────▶│ ntfy Plugin  │────▶│  ntfy.sh    │
│ (localhost) │     │  (in-proc)   │     │  (cloud)    │
└─────────────┘     └──────────────┘     └─────────────┘
       ▲                   │                    │
       │                   │                    │
       │                   ▼                    ▼
       │            ┌──────────────┐     ┌─────────────┐
       │◀───────────│  Callback    │◀────│  Phone      │
       │            │  Service     │     │  (ntfy app) │
       │            │  :4097       │     │             │
       │            └──────────────┘     └─────────────┘
       │            (permissions IPC +
       │             mobile UI proxy)
       │
       └── proxied via Tailscale

- "Open Session" opens a mobile-friendly UI served by the callback service
- The mobile UI proxies API requests to OpenCode (localhost only)
- Permission responses go through the callback service
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## License

MIT
