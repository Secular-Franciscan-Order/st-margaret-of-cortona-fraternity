# AGENTS.md

## Project

This repository contains a mostly static Astro website for the Franciscan
community. The production target is Cloudflare Workers Static Assets at
`https://www.stmargaretofcortona.com`.

## Commands

- `pnpm dev`: run the local Astro development server.
- `pnpm check`: run Astro type and content checks.
- `pnpm check:uploads`: enforce local media upload limits.
- `pnpm build` / `pnpm verify:deploy`: run upload, bounded CMS content,
  Astro, static-build, and parse5 built-output checks.
- `pnpm test:built-site`: run focused code-owned output invariant fixtures.
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

Deployment config lives in `wrangler.jsonc`. Keep Astro output static-first.
`src/worker.ts` owns `/api/contact` and delegates other requests to the static
assets binding. Do not introduce Astro SSR or `@astrojs/cloudflare` without a
clear requirement and owner approval.

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
- Only after a current valid activation record on tracking issue #46, reserve
  `cms/*` for Pages CMS draft-PR branches. While Pages CMS is frozen, do not
  create or use `cms/*` through Pages CMS.
- After activation, editors save only on `cms/*`, wait for read-only branch CI,
  and use **Open review PR**. That action dispatches the trusted
  `cms-review.yml` from `main`; do not create a second PR manually.
- Open a PR for changes into `main`.
- Keep PRs small enough to merge quickly after CI passes.

## Secrets

Never commit secrets, `.env` files, `.dev.vars`, Cloudflare tokens, or private
configuration. Prefer Cloudflare Workers Builds for production deploys. If a
future GitHub Actions deployment path is required, use protected GitHub
Environment secrets and document the change first.

## Contact form and personal data

- Treat contact submissions as ephemeral personal data. Never log, persist,
  commit, or create fixtures from real submissions.
- Preserve bounded request bodies, allowed HTTPS origin and Turnstile hostname
  checks, Turnstile verification, output escaping, no-store responses, and
  email-only delivery unless an approved design replaces them.

## Risk gates

Ask the owner before changing contact-data handling, security controls,
secrets or bindings, production domains or deployment ownership, page routes,
the content schema, or Pages CMS operations.

Pages CMS rich-text Source switching stays disabled. Raw HTML, iframe,
details/summary, and component-like tags are not an editable content surface;
represent variable embeds with narrow structured data and render them in
owner-reviewed Astro components. Repeat the unmerged rollout canary before a
Pages CMS upgrade or rich-text capability change.
