# Franciscan Community Site

A mostly static Astro website for the St. Margaret of Cortona Fraternity,
deployed with Cloudflare Workers Static Assets.

Production URL: <https://www.stmargaretofcortona.com>

## Project Overview

This site is built to keep the runtime simple and the content editable. Astro
generates static HTML, Cloudflare serves the built files, and Pages CMS lets
nontechnical editors update Markdown and JSON content without working locally.

The site currently includes:

- fixed pages for Home, Who We Are, Get Involved, News, and FAQ
- FAQ entries managed as individual Markdown files
- news/resource entries managed as individual Markdown files
- shared site settings and contact information in JSON
- local upload folders for approved images and PDFs

## Requirements

- Node `22.22.2`
- Corepack
- pnpm `11.5.0`

Enable the pinned package manager:

```sh
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

Install dependencies:

```sh
pnpm install
```

## Commands

```sh
pnpm dev
pnpm check
pnpm check:cms
pnpm check:cms-changes -- --base-ref origin/main --head HEAD
pnpm check:built-site
pnpm check:uploads
pnpm build
pnpm verify:deploy
pnpm test:worker
pnpm test:e2e
pnpm test:cms
pnpm test:built-site
pnpm preview
pnpm deploy
```

Important command behavior:

- `pnpm dev` runs the local Astro development server.
- `pnpm check` runs the CMS content/configuration guard and Astro checks.
- `pnpm check:cms` scans the exact Pages CMS configuration and bounded editable
  Markdown with both the renderer-facing and Pages-CMS-facing parsers.
- `pnpm check:cms-changes` compares an exact head with current `main` and
  rejects changes outside the activated CMS ownership boundary.
- `pnpm check:uploads` enforces local media upload limits.
- `pnpm check:built-site` parses `dist` and enforces the code-owned location-map
  invariant.
- `pnpm build` and `pnpm verify:deploy` run the same upload, CMS, Astro, static
  build, and built-output verification used by GitHub and Cloudflare.
- `pnpm test:worker` runs Worker request-handling tests.
- `pnpm test:e2e` runs Playwright smoke tests against `pnpm preview`.
- `pnpm test:cms` runs the unsafe-content, configuration, and changed-path
  fixture suites.
- `pnpm test:built-site` runs focused built-output invariant fixtures.
- `pnpm deploy` deploys the built site with Wrangler.

Build the site before running Playwright locally:

```sh
pnpm build
pnpm test:e2e
```

Install the Chromium test browser if it is not already available:

```sh
pnpm exec playwright install chromium
```

## Content Model

Content is organized so Pages CMS can expose editable fields without changing
the site structure.

| Content | Path | Notes |
| --- | --- | --- |
| Site settings | `src/data/site.json` | Site name, description, home hero image, and contact info |
| Fixed pages | `src/content/pages/*.md` | Home, Who We Are, Get Involved, News, FAQ |
| FAQ entries | `src/content/faqs/*.md` | One Markdown file per question |
| News/resources | `src/content/resources/*.md` | One Markdown file per newsletter/resource |
| Uploaded images | `public/uploads/images/` | Local approved web images |
| Uploaded documents | `public/uploads/documents/` | Local approved PDFs |

Fixed page routes are required by the Astro pages. Do not remove or rename the
existing fixed page files unless the routes are changed in code at the same
time.

## Pages CMS

Pages CMS configuration lives in `.pages.yml`.

**Pages CMS is frozen.** Do not use it or create a `cms/*` branch unless the
latest valid state-transition comment on [tracking issue #46](https://github.com/Secular-Franciscan-Order/st-margaret-of-cortona-fraternity/issues/46)
is an authorized `[pages-cms-activation:v1]` / `Activation complete` record.
Missing, edited, malformed, or revoked activation evidence means the freeze is
in effect. See [content ownership and the audited CMS boundary](docs/content-ownership.md).

Editors can update:

- site settings and contact information
- the home hero image and alt text
- fixed page body content
- FAQ entries
- news/resource entries
- approved image and PDF uploads

Fixed page creation, deletion, and rename operations are disabled because the
site depends on those route files existing. FAQ and resource entries can be
created, edited, unpublished, and deleted through Pages CMS only after
activation.

Pages CMS must never commit directly to `main`. After activation, `cms/*` is
reserved for Pages CMS draft-PR branches and all CMS changes require the
documented checks, preview, eligible approval, full-diff review, and human
merge.

The three Markdown body fields use the Pages CMS visual rich-text editor with
the Source switch disabled. Raw HTML, iframe, details/summary, and
component-like tags are not a lossless editing surface and are rejected; maps,
embeds, forms, and layout stay in owner-reviewed Astro code.

### Conditional Pages CMS workflow

Use this procedure only while the latest valid authorized state-transition
comment on tracking issue #46 says `Activation complete`:

1. Confirm that activation record is current and valid. Otherwise stop; Pages
   CMS is frozen.
2. In Pages CMS, select the current `main` branch first, then create a new
   `cms/<topic>` branch. Pages CMS branches from the selected branch, so verify
   this order and the starting SHA.
3. Make only the intended edits within the audited surfaces in
   `docs/content-ownership.md`.
4. Save the intended CMS changes, wait for read-only branch CI, then select
   **Open review PR** and confirm that the change is not published. The action
   dispatches `cms-review.yml` from trusted `main` and opens or reuses exactly
   one draft PR. Do not create a second PR for the branch.
5. Manually approve an initial GitHub Actions run when GitHub requires that
   approval.
6. Inspect the complete diff, shared deploy verification, and Cloudflare
   preview, and require all configured
   checks to be green. Cloudflare Workers Builds remains the only preview and
   production integration.
7. Mark the PR ready, resolve every conversation, update the branch from
   current `main`, rerun fresh checks, and re-inspect the updated diff and
   preview.
8. Obtain one eligible approval. Bot-authored CMS PRs can normally be approved
   by an administrator; an owner-authored PR cannot be self-approved.
9. A human merges only after all checks, preview, freshness, conversation,
   approval, and full-diff gates pass.

The privileged draft-PR workflow checks out trusted `main`, validates the
Pages CMS payload's workflow SHA against that exact revision, fetches the
selected `cms/**` branch without checking it out, derives its exact head for the
trusted changed-path gate, and re-fetches and rechecks that head immediately
before and after draft-PR creation or reuse. CMS-head workflows and scripts run
only in ordinary read-only CI. Human review of the full diff remains mandatory.
A PR-only
administrator bypass is an explicit, commented, audited exception after
checks, diff, and preview review. Record the GitHub bypass reason; this is never
permission to push directly to `main`.

The draft-PR workflow needs the repository setting **Allow GitHub Actions to
create and approve pull requests**. Its first run can require manual workflow
approval. Apply or test that setting and the required `main` rules only under a
separately authorized rollout; see `docs/repo-settings.md`.

Repeat the separately authorized disposable, unmerged rollout canary before
adopting a new Pages CMS release or changing any rich-text capability.

## Media Upload Rules

Media uploads are intentionally constrained because uploaded files are committed
to git history. Deleted media still remains in repository history.

Allowed image formats:

- `webp`
- `jpg`
- `jpeg`
- `png`

Allowed document format:

- `pdf`

Build-time limits enforced by `scripts/check-uploads.mjs`:

- individual image: 1 MB maximum
- individual PDF: 5 MB maximum
- total `public/uploads/`: 25 MB maximum

Prefer external links for large, externally maintained, or frequently changing
PDFs.

## Home Hero

The home hero image is configured in `src/data/site.json`:

```json
{
  "homeHero": {
    "image": "/uploads/images/new-rec-2025-2028.jpg",
    "imageAlt": "Saint Thomas More Region Secular Franciscan members gathered around a regional banner."
  }
}
```

If `homeHero.image` is empty, the site renders an intentional no-image fallback.
When setting a hero image, provide meaningful alt text.

## Common Content Tasks

Update contact information:

- Edit `src/data/site.json`.
- Update `contact.name`, `contact.email`, and `contact.phone`.
- The Get Involved page and footer both read from this shared data.

Add an FAQ:

- Add a Markdown file under `src/content/faqs/`.
- Set `question`, `order`, and `published` in frontmatter.
- Write the answer in Markdown body content.

Add a newsletter or resource:

- Add a Markdown file under `src/content/resources/`.
- Set `title`, `order`, `linkLabel`, `published`, and either `externalUrl` or
  `uploadedFile`.
- Use `externalUrl` for PDFs hosted elsewhere.
- Use `uploadedFile` only for local PDFs under `/uploads/documents/`.

Change the home hero image:

- Upload an approved image to `public/uploads/images/`.
- Update `homeHero.image` in `src/data/site.json`.
- Update `homeHero.imageAlt` with accurate alt text.
- Run `pnpm build` to confirm upload limits and schema validation pass.

## Deployment

The production target is Cloudflare Workers Static Assets. Deployment
configuration lives in `wrangler.jsonc`; Astro builds to `dist/`.

Use Cloudflare Workers Builds as the single production deploy path:

- production branch: `main`
- build command: `pnpm build`
- deploy command: `pnpm deploy`
- root directory: `/`
- package manager: Corepack with the pinned pnpm version from `package.json`

GitHub Actions is used as the merge gate and should not deploy production.
Workers Builds also runs non-production branch builds for PR preview URLs.

## Branch Workflow

This repository uses trunk-based development:

- `main` is the only long-lived branch and production source.
- Work happens on short-lived branches such as `feat/*`, `fix/*`,
  `chore/*`, and `docs/*`.
- Only after valid activation, `cms/*` is reserved for Pages CMS draft-PR
  branches; it is not a general-purpose branch prefix.
- Pull requests merge to `main` only after CI passes.
- Unfinished work should use drafts, hidden routes, preview builds, or feature
  flags rather than long-lived branches.

See `docs/repo-settings.md` for repository settings to apply in GitHub.

## Notes for Maintainers

- Keep the site static-first unless there is a clear requirement for SSR, APIs,
  or Worker request handling.
- A static Astro build does not need the `@astrojs/cloudflare` adapter.
- Keep Astro trailing-slash behavior aligned with Cloudflare
  `assets.html_handling`.
- Do not commit generated output such as `dist/`, `.astro/`, or `.wrangler/`.
- Do not commit secrets, `.env` files, `.dev.vars`, Cloudflare tokens, or
  private configuration.
- pnpm dependency build-script approvals are recorded in `pnpm-workspace.yaml`.
  Keep that file in sync when dependency changes introduce new packages that
  need install-time build scripts.
