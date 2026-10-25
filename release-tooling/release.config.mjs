// GitHub-only Semantic Versioning: no npm publishing or direct branch commits.
export default {
  branches: [
    { name: "main" },
    { name: "dev", channel: "beta", prerelease: "beta" }
  ],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", {
      preset: "conventionalcommits",
      releaseRules: [
        { breaking: true, release: "major" },
        { type: "feat", release: "minor" },
        { type: "fix", release: "patch" },
        { type: "perf", release: "patch" },
        { type: "revert", release: "patch" },
        { type: "docs", release: false },
        { type: "chore", release: false },
        { type: "ci", release: false },
        { type: "test", release: false },
        { type: "build", release: false },
        { type: "release", release: false }
      ]
    }],
    ["@semantic-release/release-notes-generator", {
      preset: "conventionalcommits"
    }],
    ["@semantic-release/github", {
      successComment: false,
      failComment: false
    }]
  ]
};
