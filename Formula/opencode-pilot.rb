# NOTE: This formula has moved to athal7/homebrew-tap.
# Install with: brew install athal7/tap/opencode-pilot
# This copy is kept for backward compatibility only.

class OpencodePilot < Formula
  desc "Automation daemon for OpenCode - polls GitHub/Linear issues and spawns sessions"
  homepage "https://github.com/athal7/opencode-pilot"
  url "https://github.com/athal7/opencode-pilot/archive/refs/tags/v0.27.1.tar.gz"
  sha256 "e11105928008adc2d1a3941b0ecf2d9435959fe01af93054540b0c4c0f8ecf2e"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  service do
    run [opt_bin/"opencode-pilot", "start"]
    keep_alive true
    log_path var/"log/opencode-pilot.log"
    error_log_path var/"log/opencode-pilot.error.log"
    working_dir Dir.home
    environment_variables PATH: "#{HOMEBREW_PREFIX}/bin:#{HOMEBREW_PREFIX}/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
  end

  def caveats
    <<~EOS
      Configuration file: ~/.config/opencode/pilot/config.yaml

      To start the service:
        brew services start opencode-pilot

      To check status:
        opencode-pilot status

      Note: Requires OpenCode to be running for session creation.
    EOS
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/opencode-pilot help")
  end
end