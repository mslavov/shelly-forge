# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-03

### Added
- Build manifests with source and artifact sizes, SHA-256 hashes, and runtime settings.
- Script selectors for builds and deployments, including `solution/script` and `solution-script`.
- Configurable on-device names through `targetScriptName` and duplicate device-target validation.
- GitHub Actions publishing for new stable versions on `main`, using npm trusted publishing.

### Fixed
- Compile bundled scripts to ES5 before minification.
- Deploy only the selected script instead of ignoring the selector.
- Redeploy unchanged code when its target device or on-device name changes.
- Load `bonjour-service` through its CommonJS exports under Node ESM.
- Report configured solution names in build summaries.

### Security
- Update Axios, esbuild, and Inquirer; remove the unused nodemon dependency.
- Override the vulnerable transitive `follow-redirects` dependency.

## [0.2.1] - 2026-09-09

### Added
- Comprehensive documentation system with multiple guides and references
- Complete CLI command reference documentation (`docs/tech/cli-reference.md`)
- Detailed Shelly API reference documentation (`docs/tech/api-reference.md`)
- Data structures and schemas reference (`docs/tech/database-reference.md`)
- Enhanced getting started guide with practical examples
- Troubleshooting guide for common issues (`docs/guides/troubleshooting.md`)
- Developer guide for contributors (`docs/developer-guide.md`)
- Updated system overview with complete architecture details

### Changed
- Reorganized documentation structure with improved navigation
- Updated INDEX.md to serve as central documentation hub
- Enhanced getting-started.md with AI-assisted workflow examples

### Fixed
- Preserve non-ASCII characters as UTF-8 in built Shelly scripts
- Align CLI, MCP, and generated-project dependency versions with the package release

### Documentation
- Added comprehensive documentation covering all aspects of the framework
- Created structured documentation hierarchy in docs/ directory
- Provided extensive code examples and best practices

---

## [1.0.0] - YYYY-MM-DD

### Added
- Initial release
- Feature list here

### Changed
- What was modified

### Fixed
- What was repaired

---

<!-- 
Template for new versions:

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Vulnerability fixes
-->
