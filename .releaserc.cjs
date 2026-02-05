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
    
    // Update version in package.json (in memory) and publish to npm with provenance
    // Note: version is NOT committed back to repo - only the published package has it
    ['@semantic-release/npm', { provenance: true }],
    
    // Create GitHub release (this is the source of truth for versions)
    '@semantic-release/github'
  ]
};
