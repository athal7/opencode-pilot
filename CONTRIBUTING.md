# Contributing to opencode-pilot

Thanks for your interest in contributing!

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/athal7/opencode-pilot.git
   cd opencode-pilot
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

Run the test suite:
```bash
npm test
```

This runs `test/unit/*.test.js` using Node.js built-in test runner.

## Writing Tests

Tests use Node.js built-in `node:test` and `node:assert` modules:

```javascript
import { test, describe } from "node:test";
import assert from "node:assert";
import { myFunction } from "../../service/module.js";

describe("myFunction", () => {
  test("returns expected value", () => {
    assert.strictEqual(myFunction(), "expected");
  });
});
```

Place test files in `test/unit/<module>.test.js`.

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
