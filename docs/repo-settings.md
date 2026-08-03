# Repository Settings

Apply these settings in GitHub after the first CI workflow has run at least
once. Some settings need the exact status check name before they can be
selected.

## General

- Default branch: `main`
- Merge method: squash merge enabled
- Merge commits: disabled
- Rebase merges: disabled
- Auto-delete head branches: enabled

## Branch Protection

Protect `main` with a branch protection rule or repository ruleset:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require the CI workflow status check once GitHub has created it. The expected
  job name is `Check and build`.
- Require conversation resolution before merging.
- Require linear history if compatible with the repo workflow.
- Block force pushes.
- Block branch deletion.

For a solo-maintained repo, do not require an approval review at first; rely on
CI as the merge gate. If multiple maintainers become active, require one review
approval and dismiss stale approvals.

## Actions

- Default workflow permissions: read-only.
- Allow GitHub Actions for this repository.
- Prefer pinned third-party actions or trusted first-party actions.
- Do not use GitHub Actions as a production deployer while Cloudflare Workers
  Builds is configured as the deploy path.

## Security

Enable the features available for this repository:

- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection
- Code scanning / CodeQL

## Cloudflare Workers Builds

Configure Cloudflare Workers Builds as the single production deploy path:

- Production branch: `main`
- Production URL: `https://www.stmargaretofcortona.com`
- Root directory: `/`
- Build command: `pnpm build`
- Deploy command: `pnpm deploy`
- Package manager setup: Corepack enabled, using pnpm from `package.json`
- Non-production branch builds: enabled for PR preview URLs

Do not also add a GitHub Actions production deploy unless Workers Builds is
disabled or the deploy ownership is intentionally changed.
