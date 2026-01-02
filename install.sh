#!/usr/bin/env bash
#
# Install opencode-ntfy plugin and callback service
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/athal7/opencode-ntfy/main/install.sh | bash
#
# Or from a local clone:
#   ./install.sh
#

set -euo pipefail

REPO="athal7/opencode-ntfy"
PLUGIN_NAME="opencode-ntfy"
PLUGIN_DIR="$HOME/.config/opencode/plugins/$PLUGIN_NAME"
SERVICE_DIR="$HOME/.local/share/opencode-ntfy"
CONFIG_FILE="$HOME/.config/opencode/opencode.json"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="io.opencode.ntfy.plist"
PLUGIN_FILES="index.js notifier.js callback.js hostname.js nonces.js config.js service-client.js"
SERVICE_FILES="server.js"

echo "Installing $PLUGIN_NAME..."
echo ""

# Create directories
mkdir -p "$PLUGIN_DIR"
mkdir -p "$SERVICE_DIR"

# Check if we're running from a local clone or need to download
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null)" && pwd 2>/dev/null)" || SCRIPT_DIR=""

if [[ -n "$SCRIPT_DIR" ]] && [[ -f "$SCRIPT_DIR/plugin/index.js" ]]; then
  # Local install from clone
  echo "Installing from local directory..."
  
  echo ""
  echo "Plugin files:"
  for file in $PLUGIN_FILES; do
    if [[ -f "$SCRIPT_DIR/plugin/$file" ]]; then
      cp "$SCRIPT_DIR/plugin/$file" "$PLUGIN_DIR/$file"
      echo "  Installed: plugin/$file -> $PLUGIN_DIR/$file"
    fi
  done
  
  echo ""
  echo "Service files:"
  for file in $SERVICE_FILES; do
    if [[ -f "$SCRIPT_DIR/service/$file" ]]; then
      cp "$SCRIPT_DIR/service/$file" "$SERVICE_DIR/$file"
      echo "  Installed: service/$file -> $SERVICE_DIR/$file"
    fi
  done
else
  # Remote install - download from GitHub
  echo "Downloading plugin files from GitHub..."
  
  for file in $PLUGIN_FILES; do
    echo "  Downloading: plugin/$file"
    if curl -fsSL "https://raw.githubusercontent.com/$REPO/main/plugin/$file" -o "$PLUGIN_DIR/$file"; then
      echo "  Installed: $file"
    else
      echo "  ERROR: Failed to download $file"
      exit 1
    fi
  done
  
  echo ""
  echo "Downloading service files from GitHub..."
  
  for file in $SERVICE_FILES; do
    echo "  Downloading: service/$file"
    if curl -fsSL "https://raw.githubusercontent.com/$REPO/main/service/$file" -o "$SERVICE_DIR/$file"; then
      echo "  Installed: $file"
    else
      echo "  ERROR: Failed to download $file"
      exit 1
    fi
  done
fi

echo ""
echo "Plugin files installed to: $PLUGIN_DIR"
echo "Service files installed to: $SERVICE_DIR"

# Install LaunchAgent plist (macOS only)
if [[ "$(uname)" == "Darwin" ]]; then
  echo ""
  echo "Installing LaunchAgent for callback service..."
  
  mkdir -p "$PLIST_DIR"
  
  # Find node path (handle both Intel and Apple Silicon Macs)
  NODE_PATH=$(command -v node 2>/dev/null)
  if [[ -z "$NODE_PATH" ]]; then
    # Try Homebrew paths
    if [[ -x "/opt/homebrew/bin/node" ]]; then
      NODE_PATH="/opt/homebrew/bin/node"
    elif [[ -x "/usr/local/bin/node" ]]; then
      NODE_PATH="/usr/local/bin/node"
    else
      echo "  WARNING: node not found, please install Node.js"
      NODE_PATH="/usr/local/bin/node"
    fi
  fi
  
  # Generate plist with correct paths
  cat > "$PLIST_DIR/$PLIST_NAME" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.opencode.ntfy</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$SERVICE_DIR/server.js</string>
    </array>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>$HOME/.local/share/opencode-ntfy/opencode-ntfy.log</string>
    
    <key>StandardErrorPath</key>
    <string>$HOME/.local/share/opencode-ntfy/opencode-ntfy.log</string>
    
    <key>WorkingDirectory</key>
    <string>$SERVICE_DIR</string>
</dict>
</plist>
EOF
  
  echo "  LaunchAgent installed to: $PLIST_DIR/$PLIST_NAME"
  echo ""
  echo "  To start the callback service:"
  echo "    launchctl load $PLIST_DIR/$PLIST_NAME"
  echo ""
  echo "  To stop the callback service:"
  echo "    launchctl unload $PLIST_DIR/$PLIST_NAME"
fi

# Configure opencode.json
echo ""
echo "Configuring OpenCode..."

if [[ -f "$CONFIG_FILE" ]]; then
  # Check if plugin already configured
  if grep -q "$PLUGIN_DIR" "$CONFIG_FILE" 2>/dev/null; then
    echo "  Plugin already configured in opencode.json"
  else
    echo ""
    echo "  Would you like to add the plugin to opencode.json? [Y/n]"
    read -r response </dev/tty || response="y"
    if [[ "$response" != "n" && "$response" != "N" ]]; then
      # Use node to update JSON safely
      if command -v node >/dev/null 2>&1; then
        node -e "
          const fs = require('fs');
          const configPath = '$CONFIG_FILE';
          const pluginDir = '$PLUGIN_DIR';
          
          let config;
          try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          } catch {
            config = {};
          }
          
          config.plugin = config.plugin || [];
          if (!config.plugin.includes(pluginDir)) {
            config.plugin.push(pluginDir);
          }
          
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        "
        echo "  Plugin added to opencode.json"
      else
        echo "  WARNING: node not found, please manually add to opencode.json:"
        echo ""
        echo "    \"plugin\": [\"$PLUGIN_DIR\"]"
      fi
    else
      echo "  Skipped. You can manually add the plugin path to opencode.json later."
    fi
  fi
else
  echo ""
  echo "  No opencode.json found. Create one with the plugin configured? [Y/n]"
  read -r response </dev/tty || response="y"
  if [[ "$response" != "n" && "$response" != "N" ]]; then
    mkdir -p "$(dirname "$CONFIG_FILE")"
    cat > "$CONFIG_FILE" << EOF
{
  "plugin": ["$PLUGIN_DIR"]
}
EOF
    echo "  Created $CONFIG_FILE"
  else
    echo "  Skipped. You can create opencode.json later with:"
    echo ""
    echo "    {\"plugin\": [\"$PLUGIN_DIR\"]}"
  fi
fi

# Environment variable check and guidance
echo ""
echo "========================================"
echo "  Installation complete!"
echo "========================================"
echo ""

# Check if NTFY_TOPIC is set
if [[ -n "${NTFY_TOPIC:-}" ]]; then
  echo "NTFY_TOPIC is set: $NTFY_TOPIC"
  echo ""
  echo "The plugin is ready to use!"
else
  echo "REQUIRED: Set NTFY_TOPIC in your environment."
  echo ""
  echo "Add to ~/.env (if using direnv) or your shell profile:"
  echo ""
  echo "  export NTFY_TOPIC=your-secret-topic"
fi

echo ""
echo "Optional configuration:"
echo "  NTFY_SERVER=https://ntfy.sh        # ntfy server (default: ntfy.sh)"
echo "  NTFY_TOKEN=tk_xxx                  # ntfy access token for protected topics"
echo "  NTFY_CALLBACK_HOST=host.ts.net     # Callback host for interactive notifications"
echo "  NTFY_CALLBACK_PORT=4097            # Callback server port"
echo "  NTFY_IDLE_DELAY_MS=300000          # Idle notification delay (5 min)"

echo ""
echo "For interactive permissions:"
echo "  1. Set NTFY_CALLBACK_HOST to your machine's hostname (e.g., via Tailscale)"
echo "  2. Start the callback service: launchctl load ~/Library/LaunchAgents/$PLIST_NAME"
echo "  3. Ensure your phone can reach the callback URL"
echo ""
