# Contributing to opencode-ntfy

Thanks for your interest in contributing!

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/athal7/opencode-ntfy.git
   cd opencode-ntfy
   ```

2. Install the plugin locally for testing:
   ```bash
   ./install.sh
   ```

3. Set required environment variables:
   ```bash
   export NTFY_TOPIC=your-test-topic
   ```

## Running Tests

Run the full test suite:
```bash
./test/run_tests.bash
```

The test suite includes:
- **File structure tests** - Verify all plugin files exist
- **Syntax validation** - Run `node --check` on all JS files
- **Export structure tests** - Verify expected functions are exported
- **Integration tests** - Test plugin loads in OpenCode without hanging (requires opencode CLI)

## Writing Tests

Tests live in `test/` using bash test helpers from `test_helper.bash`.

Example test:
```bash
test_my_feature() {
  # Use assertions from test_helper.bash
  assert_file_exists "$PLUGIN_DIR/myfile.js"
  assert_contains "$output" "expected string"
}

# Register and run
run_test "my_feature" "test_my_feature"
```

For JavaScript unit tests, use Node.js inline:
```bash
test_function_works() {
  node --input-type=module -e "
    import { myFunction } from '../plugin/module.js';
    if (myFunction() !== 'expected') throw new Error('Failed');
    console.log('PASS');
  " || return 1
}
```

## Code Style

- Use ES modules (`import`/`export`)
- Use `async`/`await` for async operations
- Log with `[opencode-ntfy]` prefix
- Handle errors gracefully (log, don't crash OpenCode)
- No external dependencies (use Node.js built-ins only)

## Plugin Architecture

```
plugin/
├── index.js      # Main entry point, event handlers
├── notifier.js   # ntfy HTTP client
├── callback.js   # HTTP callback server for interactive responses
├── hostname.js   # Callback host discovery (Tailscale, env, localhost)
└── nonces.js     # Single-use nonces for callback authentication
```

## Submitting Changes

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes
3. Run tests: `./test/run_tests.bash`
4. Commit with a clear message following conventional commits:
   - `feat(#1): add idle notifications`
   - `fix(#3): handle network timeout`
5. Push and open a pull request

## Releasing

Releases are automated via GitHub Actions. To create a release:

1. Tag the commit: `git tag v1.0.0`
2. Push the tag: `git push origin v1.0.0`

The release workflow will:
1. Run tests
2. Create a tarball
3. Create a GitHub release with release notes
