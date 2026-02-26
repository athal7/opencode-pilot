class OpencodePilot < Formula
  desc "Automation daemon for OpenCode - polls GitHub/Linear issues and spawns sessions"
  homepage "https://github.com/athal7/opencode-pilot"
  url "https://github.com/athal7/opencode-pilot/archive/refs/tags/v0.25.0.tar.gz"
  sha256 "85deacd5bc6556751d74ddfb2067a9d80b090ba3337222657cc7bc3d2c9d6e45"
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
