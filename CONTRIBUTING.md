# Contributing to Shelly Forge

## Set up

Use Node.js 22.12 or newer and npm. Clone the repository and install its locked dependencies:

```sh
git clone https://github.com/mslavov/shelly-forge.git
cd shelly-forge
npm ci
npm run build
```

Create a branch from `main` for your changes. The [agent contributor guide](AGENTS.md) maps the source directories and lists code conventions. The [design document](docs/design.html) explains the build, device, deployment, and simulator design.

## Development commands

These commands run in this repository, not in a generated device project.

| Command | What it does |
| --- | --- |
| `npm run build` | Compile the CLI and simulator into `dist/`. |
| `npm run typecheck` | Check source and repository tests without emitting files. |
| `npm test` | Build, then run all Vitest tests. |
| `npx vitest run tests/build` | Run a selected test area after building. |
| `npm run smoke` | Pack the package, initialize a temporary consumer project, and run its checks and tests. |
| `npm run watch` | Recompile the CLI when source files change. |
| `npm pack --dry-run` | Inspect the npm package contents without publishing. |

The smoke test installs dependencies and needs npm registry access. The regular test suite uses local fakes and does not contact real devices. Rebuild before CLI integration tests because they run `dist/cli.js`.

## Tests and changes

Tests live under `tests/<area>/*.test.ts`. Areas cover core behavior, builds, devices, deployment, device commands, development watches, logs, discovery, scaffolding, the simulator, typings, skills, and releases. Unit tests import from `src/`.

[tests/helpers](tests/helpers/) contains shared fixtures:

- `project.ts` creates temporary projects and runs the built CLI.
- `fake-device.ts` provides a local HTTP device with failure injection and digest authentication.
- `fake-log-server.ts` provides a local WebSocket log server.

Use those fixtures or injected dependencies instead of hardware. Add a regression test for a bug fix. Keep credentials and private device details out of fixtures and reports. Run these checks before opening a pull request:

```sh
npm run build
npm run typecheck
npx vitest run
npm run smoke
npm pack --dry-run
git diff --check
```

For CLI changes, update the [README](README.md) and [CLI skill](skills/shelly-forge/SKILL.md), including its references. Device API or runtime changes also need matching [scripting guidance](skills/shelly-scripting/SKILL.md), types, simulator behavior, and tests where applicable. Update the [changelog](CHANGELOG.md) for user-visible changes.

Use conventional commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`. Explain the behavior change, tests run, and any unverified device behavior in the pull request. Report bugs through [GitHub Issues](https://github.com/mslavov/shelly-forge/issues) with reproduction steps, expected and actual results, OS, Node.js version, CLI version, and relevant model and firmware details. Redact secrets.

## Release process

1. Update `CHANGELOG.md` for the release.
2. Run `npm version minor --no-git-tag-version`, or use `patch` for a bug-fix release. The [version hook](scripts/sync-template-version.mjs) updates the template's `shelly-forge` dependency to match. Review `package.json`, `package-lock.json`, and `templates/default/package.json` together.
3. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run smoke`, and `npm pack --dry-run`.
4. Commit the reviewed source, changelog, package metadata, lockfile, and template update. Merge the reviewed release commit to `main`.

The [publish workflow](.github/workflows/publish.yml) tests pull requests and `main` on Ubuntu with Node.js 22.12 and 24. Each test job runs type checks, the full test suite, the packed consumer smoke test, and a package dry run. Run the smoke script with `npm run smoke`; it invokes npm's JavaScript CLI through Node without a shell, so paths containing spaces remain single arguments. This workflow does not include a Windows runner. After both Node.js jobs pass on `main` in `mslavov/shelly-forge`, the publish job checks npm's published versions through [check-release.mjs](scripts/check-release.mjs).

The workflow publishes a new stable version with provenance and the `latest` tag. It skips an already published version and rejects prereleases and downgrades. A registry error stops publishing. Git tags do not trigger this workflow.

If publishing fails after tests pass, rerun the workflow in GitHub Actions or manually dispatch it on `main`. Do not bump the version just to retry a version that npm has not published.

### npm trusted publishing

Configure the npm package's trusted publisher with:

| Setting | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `mslavov` |
| Repository | `shelly-forge` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty. |
| Publishing method | Direct publishing with `npm publish`. |

The publish job uses Node.js 24, npm 12.2.1, and `id-token: write` for OIDC authentication. It runs `npm publish --provenance --access public --tag latest` without an `NPM_TOKEN` secret. Keep the trusted publisher settings aligned with the workflow if the repository or workflow filename changes.

Complete the first publish within two days of creating the trusted publisher. Recreate the publisher if it expires unused. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup requirements.

## License

Contributions use the repository's [MIT license](LICENSE).
