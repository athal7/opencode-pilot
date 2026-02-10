# Contributing to opencode-pilot

Thanks for your interest in contributing!

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/athal7/opencode-pilot.git
   cd opencode-pilot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running Tests

```bash
npm test                # Unit tests
npm run test:integration # Integration tests
npm run test:all        # All tests
```

Tests use the Node.js built-in test runner (`node:test`) with `node:assert`.

## Writing Tests

Tests live in `test/unit/` and `test/integration/`. Each test file follows this pattern:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('myModule', () => {
  test('does the thing', () => {
    assert.strictEqual(actual, expected);
  });
});
```

## Code Style

- Use ES modules (`import`/`export`)
- Use `async`/`await` for async operations
- Log with `[opencode-pilot]` prefix
- Handle errors gracefully (log, don't crash OpenCode)
- No external dependencies beyond what's in `package.json`

## Project Architecture

```
plugin/
└── index.js              # OpenCode plugin entry point (auto-starts daemon)
service/
├── server.js             # HTTP server and polling orchestration
├── poll-service.js       # Polling lifecycle management
├── poller.js             # MCP tool polling
├── actions.js            # Session creation and template expansion
├── readiness.js          # Evaluate item readiness (labels, deps, priority)
├── worktree.js           # Git worktree management
├── repo-config.js        # Repository discovery and config
├── logger.js             # Debug logging
├── utils.js              # Shared utilities
├── version.js            # Package version detection
└── presets/
    ├── index.js           # Preset loader
    ├── github.yaml        # GitHub source presets
    └── linear.yaml        # Linear source presets
```

## Submitting Changes

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes
3. Run tests: `npm test`
4. Commit with a clear message following conventional commits:
   - `feat(#1): add idle notifications`
   - `fix(#3): handle network timeout`
5. Push and open a pull request

## Releasing

Releases are automated via [semantic-release](https://github.com/semantic-release/semantic-release) on merge to `main`. The CI pipeline will:

1. Run tests
2. Determine the next version from commit messages
3. Publish to npm
4. Commit version bump (`package.json`, `package-lock.json`) back to the repo
5. Create a GitHub release
6. Update the Homebrew formula
