# AGENTS.md

## Project

This repository contains a mostly static Astro website for the Franciscan
community. The production target is Cloudflare Workers Static Assets at
`https://stmargaretofcortona.endian.dev`.

## Commands

- `pnpm dev`: run the local Astro development server.
- `pnpm check`: run Astro type and content checks.
- `pnpm build`: run `astro check` and create the static `dist/` build.
- `pnpm test:worker`: run Worker request-handling tests.
- `pnpm test:e2e`: run Playwright smoke tests against the preview server.
- `pnpm preview`: preview the built site locally.
- `pnpm deploy`: deploy with Wrangler.

Run `pnpm check` and `pnpm build` before considering infrastructure or site
changes complete. Run `pnpm test:worker` when changing Worker request handling.
Run `pnpm test:e2e` when page routes, preview behavior, or deployment-facing
static behavior changes.

## Toolchain

- Node is pinned in `.node-version`.
- pnpm is pinned through `packageManager` in `package.json`.
- Use Corepack to activate pnpm.
- pnpm dependency build-script approvals live in `pnpm-workspace.yaml`.
- Do not commit generated output such as `dist/`, `.astro/`, or `.wrangler/`.

## Deployment

Deployment config lives in `wrangler.jsonc`. Keep this project static unless
there is a clear requirement for SSR, APIs, or Worker request handling. A static
Astro build does not need the `@astrojs/cloudflare` adapter.

## Astro Conventions

- Keep `astro.config.mjs` static-first.
- Do not add a placeholder `site` value. Add the canonical production URL only
  when it is known.
- Keep Astro `trailingSlash` behavior aligned with Cloudflare
  `assets.html_handling`.
- Maintain `src/pages/404.astro` while `not_found_handling` is set to
  `404-page`.

## Git Workflow

Use trunk-based development:

- `main` is the only long-lived branch.
- Use short-lived branches: `feat/*`, `fix/*`, `chore/*`, `docs/*`.
- Open a PR for changes into `main`.
- Keep PRs small enough to merge quickly after CI passes.

### Credential checks

When checking existing GitHub or Cloudflare CLI authentication, run the check
outside the filesystem sandbox (`require_escalated`). Sandboxed credential paths
can be read-only or unavailable and may produce false authentication failures.

## Secrets

Never commit secrets, `.env` files, `.dev.vars`, Cloudflare tokens, or private
configuration. Prefer Cloudflare Workers Builds for production deploys. If a
future GitHub Actions deployment path is required, use protected GitHub
Environment secrets and document the change first.
