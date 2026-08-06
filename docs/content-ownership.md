# Content Ownership and Pages CMS Boundary

Pages CMS is frozen. Do not use it or create a `cms/*` branch unless the latest
valid state-transition comment on [tracking issue #46](https://github.com/Secular-Franciscan-Order/st-margaret-of-cortona-fraternity/issues/46)
is an authorized `[pages-cms-activation:v1]` / `Activation complete` record.
Missing, edited, malformed, or revoked activation evidence means the freeze is
in effect.

After activation, Pages CMS may edit only the surfaces in the tables below.
The configuration, schemas, page composition, components, workflows, scripts,
package files, and repository instructions remain code-owned.

## CMS-owned surfaces after activation

| Surface | Allowed values | Consumer | Validation | Content owner |
| --- | --- | --- | --- | --- |
| `src/data/site.json` → `name` | Required string | Page titles and footer in `SiteLayout.astro` | Strict JSON, the exact Pages CMS configuration allowlist, `siteDataSchema`, and human diff review | Approved content editor |
| `src/data/site.json` → `description` | Required text string | Default page description in `SiteLayout.astro` | Same as site name | Approved content editor |
| `src/data/site.json` → `homeHero.image` | Empty string or `/uploads/images/<safe-filename>.(webp\|jpg\|jpeg\|png)` | Home hero in `src/pages/index.astro` | Configuration allowlist, site-data schema, upload checks, changed-path gate, and human preview/diff review | Approved content editor |
| `src/data/site.json` → `homeHero.imageAlt` | String; meaningful text is required when an image is selected | Home hero alternative text in `src/pages/index.astro` | Configuration allowlist, site-data schema, and human accessibility review | Approved content editor |
| `src/data/site.json` → `contact.name` | Required string | Get Involved contact section and footer | Configuration allowlist, site-data schema, and human diff review | Approved content editor |
| `src/data/site.json` → `contact.email` | Required email string | Get Involved and footer `mailto:` links | Configuration allowlist, site-data schema, and human diff review | Approved content editor |
| `src/data/site.json` → `contact.phone` | Required string | Get Involved contact section and footer | Configuration allowlist, site-data schema, and human diff review | Approved content editor |
| `src/content/pages/home.md` | YAML frontmatter plus safe Markdown body; fixed route `/` | `src/pages/index.astro` | Strict YAML/frontmatter, safe-Markdown and destination checks, exact fixed-page map, Astro schema/build, and human preview/diff review | Approved content editor; route/file identity is code-owned |
| `src/content/pages/who-we-are.md` | YAML frontmatter plus safe Markdown body; fixed route `/who-we-are` | `src/pages/[...slug].astro`; the map is separately code-owned | Same as fixed home page, plus the parse5 built-map invariant | Approved content editor; route/file identity and map are code-owned |
| `src/content/pages/get-involved.md` | YAML frontmatter plus safe Markdown body; fixed route `/get-involved` | `src/pages/[...slug].astro`; contact UI is separately code-owned | Same as fixed home page | Approved content editor; route/file identity and contact UI are code-owned |
| `src/content/pages/news.md` | YAML frontmatter plus safe Markdown body; fixed route `/news` | `src/pages/news.astro` | Same as fixed home page | Approved content editor; route/file identity and resource layout are code-owned |
| `src/content/pages/faq.md` | YAML frontmatter plus safe Markdown body; fixed route `/faq` | `src/pages/faq.astro` | Same as fixed home page | Approved content editor; route/file identity and FAQ layout are code-owned |
| `src/content/faqs/**/*.md` | YAML frontmatter fields `question` (string), `order` (number), `published` (boolean), plus safe Markdown body | `getPublishedFaqs()` and `src/pages/faq.astro` | Strict YAML/frontmatter, safe-Markdown and destination checks, Astro schema/build, changed-path gate, and human preview/diff review | Approved content editor |
| `src/content/resources/**/*.md` | YAML frontmatter fields `title` (string), `order` (number), `linkLabel` (string), `uploadedFile` (empty or approved PDF path), `externalUrl` (empty or HTTP(S)), `published` (boolean), plus safe Markdown body | `getPublishedResources()` and `src/pages/news.astro` | Strict YAML/frontmatter, safe-Markdown and destination checks, Astro schema/build, changed-path gate, and human preview/diff review | Approved content editor |
| `public/uploads/images/<safe-filename>.(webp\|jpg\|jpeg\|png)` | Approved image file with a safe filename | Markdown images, site settings, and reviewed static asset references | Configuration allowlist, changed-path gate, `check:uploads`, build, and human asset/diff review | Approved content editor |
| `public/uploads/documents/<safe-filename>.pdf` | Approved PDF with a safe filename | Resource `uploadedFile` links | Configuration allowlist, changed-path gate, `check:uploads`, build, and human document/diff review | Approved content editor |

Fixed-page frontmatter fields are `title`, the exact read-only `route`,
`navLabel`, `navOrder`, and optional `description`. FAQ and resource files may
be created, renamed, or deleted; fixed pages may not. `.gitkeep` files in the
upload roots are code-owned and are not allowed CMS media changes.

## Markdown and destination boundary

The safe Markdown subset is ordinary headings, paragraphs, emphasis,
links/images, lists, blockquotes, thematic breaks, escaped punctuation,
URL/email autolinks, inline code, fenced code, and hard breaks. Code spans and
fenced code may show otherwise unsafe-looking examples because they are not
executed. Tables, strikethrough, and task-list tokens are outside the approved
editor-native subset.

Raw HTML, comments/declarations, iframe, details/summary, and component-like
raw tags are forbidden outside code. Ordinary comparison, brace, directive-like,
and import/export wording is inert prose in this repository's `.md` files; the
guard does not attempt to parse it as JavaScript. Links may use HTTP, HTTPS, or
`mailto`, or be root-relative, document-relative, or fragment-only.
Protocol-relative destinations, other schemes, controls, obfuscated schemes,
and invalid URL forms are forbidden. Markdown images may refer only to
`/uploads/images/<safe-filename>.(webp|jpg|jpeg|png)` with no traversal, encoded
separators, query, fragment, external host, or other extension.

The guard uses `mdast-util-from-markdown@2.0.3` for renderer-facing structure
and the same `marked@17.0.5` tokenizer version used by Pages CMS 2.1.8 for the
editor-facing boundary. Each Markdown file is limited to 16 KiB and the
repository scan reports at most 50 diagnostics. The visual editor's Source
switch is disabled on every rich-text field; unsupported raw source is not a
lossless CMS editing surface.

## Code-owned boundary

Everything not listed as CMS-owned above is forbidden in `cms/**` changes.
That includes `.pages.yml`, all source and component files, workflows,
scripts, package and lock files, docs, repository instructions, route and
collection definitions, and frontmatter schemas. In particular,
`LocationMap.astro` and its placement on `/who-we-are` are code-owned even
though adjacent prose is CMS-owned.

Future variable maps or embeds must use narrow structured data, such as a
reviewed provider plus identifier/URL, rendered by an owner-reviewed Astro
component. Arbitrary iframe or HTML fields are not an approved extension. If
lossless raw source is ever required, use a separately reviewed Pages CMS
`code` or `text` field or a pinned self-hosted editor; do not expose it through
the visual rich-text field.

The explicit **Open review PR** action dispatches `cms-review.yml` at trusted
`main`. Its write-capable job parses one bounded JSON payload, verifies its
workflow SHA against the exact trusted `main` revision, validates and fetches
the same-repository `cms/**` branch without checking it out, derives its exact
head for the trusted changed-path gate, and re-fetches and rechecks that head
immediately before and after draft-PR creation or reuse. CMS-head code runs only
in ordinary read-only CI.
Reviewers must still inspect the complete diff and preview before a human
merge.

## Audit record

The R6 audit was performed against base
`cd65c6c27be0beade8c0aec4cfa4ae8bf4e20058` and covered these search classes:

1. Every `content` and `media` entry, field, operation, format, path, view,
   filename rule, rich-text option, and upload option in `.pages.yml`.
2. Repository-wide references to `src/data/site.json`, all three content
   roots, both upload roots, `siteData`, `getCollection`, and the page/FAQ/news
   consumers.
3. Astro loader patterns and every schema/model field in
   `src/content.config.ts` and `src/lib/site-data.ts`.
4. Every current editable file and frontmatter key: five fixed pages, thirteen
   FAQs, ten resources, three uploaded images, no uploaded PDF, and the
   code-owned `.gitkeep` placeholders.
5. Markdown bodies with both maintained parsers for raw HTML,
   comments/declarations, iframe/details/component-like tags, non-native Marked
   tokens, inline/reference links and images, and autolinks. Normal comparison,
   import/export, brace, and directive-like prose remains inert. No code-owned
   construct remained in CMS content after the map moved to
   `LocationMap.astro`.
6. Repository instructions for direct-main CMS guidance, `cms/*` branch
   ownership, activation claims, Actions PR permissions, and protection/ruleset
   guidance. The stale direct-main instruction was removed; the repository
   remains frozen pending an authoritative activation record.

R7 retained that ownership audit, replaced the custom ESM/JSX scanner with the
bounded maintained-parser boundary above, locked the explicit trusted-main
review action, and added parse5 verification of the built code-owned map.

Any new CMS path, field, rich-text surface, operation, media capability, or
consumer is a code change: update this audit, the exact configuration allowlist,
fixtures, and review documentation in an owner-approved change before exposing
it to Pages CMS.

Repeat the separately authorized disposable, unmerged Pages CMS canary before
adopting a new Pages CMS release or changing any rich-text capability.
