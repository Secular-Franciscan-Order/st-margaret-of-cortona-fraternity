# Repository Settings Target

This document describes the required post-activation target, not the current
repository state. Do not apply, test, or change these controls without separate
owner authorization. Tracking-issue state-transition comments are authoritative:
routine Pages CMS use is allowed only while the latest valid authorized
`[pages-cms-activation:v1]` comment on [issue #46](https://github.com/Secular-Franciscan-Order/st-margaret-of-cortona-fraternity/issues/46)
has state `Activation complete`. A missing, edited, malformed, or later
`Activation revoked` record means Pages CMS is frozen.

## General

- Default branch: `main`
- Merge method: squash merge enabled
- Merge commits: disabled
- Rebase merges: disabled
- Auto-delete head branches: enabled

## Required active `main` ruleset

After an authorized rollout succeeds, an active repository ruleset targeting
`main` must:

- require a pull request before merging;
- require one eligible approval;
- require every review conversation to be resolved;
- require the branch to be up to date before merging;
- require both verified checks by exact name, app, and integration ID:
  - `Check and build` from `github-actions` (integration `15368`);
  - `Workers Builds: franciscan-community-site` from
    `cloudflare-workers-and-pages` (integration `85455`);
- block force pushes and branch deletion;
- use repository-administrator bypass mode `pull_request` only, never `always`
  or `exempt`.

The PR-only administrator bypass is an explicit, commented, audited exception
after checks, full-diff review, and preview review. It never authorizes a direct
push to `main`. A bot-authored CMS PR can normally receive an administrator's
eligible approval; an owner-authored PR cannot be self-approved.

Before any authorized change, capture the original Actions setting, branch
protection, rulesets, and effective `main` rules. Retain the original branch
protection while applying the new ruleset unless the approved rollout says
otherwise. Never test `main` with a direct push.

After applying the target, verify every effective rule read-only, including
both check identities/integration IDs and `bypass_mode: pull_request`. Inspect
that the PR-only bypass affordance is available without selecting it. An actual
bypass may be selected only during a separately authorized merge or
nonproduction test; no bypass merge is part of the Pages CMS rollout test.

On any failure, roll back every changed control, disable the new ruleset,
confirm the original protection and effective rules, restore the original
Actions setting unless its retention was explicitly authorized, publish an
authorized `Activation revoked` transition if activation had occurred, keep
the CMS freeze in effect, and stop.

## Actions

- Default workflow permissions: read-only.
- Allow GitHub Actions for this repository.
- Enable **Allow GitHub Actions to create and approve pull requests** only in
  the separately authorized rollout, after recording its original value.
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
