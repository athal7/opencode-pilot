module.exports = {
  branches: [
    'main'
  ],
  
  plugins: [
    // Analyze commits to determine release type
    // While in 0.x, breaking changes bump minor (not major) per semver spec
    ['@semantic-release/commit-analyzer', {
      releaseRules: [
        { breaking: true, release: 'minor' },
        { type: 'feat', release: 'minor' },
        { type: 'fix', release: 'patch' },
        { type: 'perf', release: 'patch' },
        { type: 'refactor', release: 'patch' },
      ]
    }],
    
    // Generate release notes
    '@semantic-release/release-notes-generator',
    
    // Publish to npm with provenance
    ['@semantic-release/npm', { provenance: true }],
    
    // Commit version bump to package.json + package-lock.json back to repo
    // Runs in 'prepare' phase AFTER npm bumps package.json, BEFORE GitHub creates the tag
    // This ensures the GitHub tarball includes the correct version
    ['@semantic-release/git', {
      assets: ['package.json', 'package-lock.json'],
      message: 'chore(release): ${nextRelease.version} [skip ci]'
    }],
    
    // Create GitHub release (creates the tag/tarball from the version-bumped commit)
    '@semantic-release/github'
  ]
};
