# Releasing `ma-firewall` to npm

The [`ma-firewall`](../packages/firewall) CLI is the one package published to npm
(everything else is workspace-internal). Publishing is automated by
[`.github/workflows/release.yml`](../.github/workflows/release.yml); the only
manual steps are the one-time token setup and cutting a version tag.

## One-time setup

1. Create an npm **automation** token with publish rights to `ma-firewall`
   (npmjs.com → Access Tokens → Generate → *Automation*).
2. Add it to the GitHub repo as a secret named **`NPM_TOKEN`**
   (Settings → Secrets and variables → Actions → New repository secret).

The first publish must be done by an account that owns the `ma-firewall` name on
npm. If the name is taken, pick a scope (e.g. `@everettjf/ma-firewall`) and update
`name` in `packages/firewall/package.json` (and the `npx` references in the docs).

## Cut a release

1. Bump the version in **`packages/firewall/package.json`** (and the root
   `package.json` / `CHANGELOG.md` to match the milestone).
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0           # must equal the firewall package version
   git push origin v0.2.0
   ```

3. The `Release ma-firewall` workflow runs: it builds the zero-dep bundle,
   verifies the tag matches the package version, self-tests the bundle (a real
   behavior change must be caught), prints the tarball contents, and
   `npm publish`es with provenance.

## Rehearse without publishing

Run the workflow manually (Actions → *Release ma-firewall* → Run workflow) with
`dry_run = true` (the default) to build, pack, and self-test without publishing.

Locally, you can verify exactly what would ship:

```bash
pnpm --filter ma-firewall build
cd packages/firewall && npm pack --dry-run     # lists dist/ma-firewall.mjs, README, package.json

# clean-room check: install the tarball with no workspace / devDeps and run it
npm pack
cd $(mktemp -d) && npm init -y >/dev/null
npm install /path/to/ma-firewall-0.2.0.tgz     # installs only ma-firewall (bundle is self-contained)
./node_modules/.bin/ma-firewall snapshot some_file.py
```

## After publishing

- `npx ma-firewall@latest snapshot <file>` should work from a clean machine.
- The npm page links back to the GitHub Actions run (provenance).
