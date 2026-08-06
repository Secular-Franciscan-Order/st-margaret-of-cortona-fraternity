import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  CMS_MARKDOWN_LIMITS,
  checkRepository,
  formatIssue,
  parseStrictYaml,
  validateMarkdownSource,
  validatePagesConfigSource
} from "../scripts/check-cms-content.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const currentConfig = readFileSync(new URL("../.pages.yml", import.meta.url), "utf8");

function rules(problems) {
  return new Set(problems.map((problem) => problem.rule));
}

function assertFailsWith(problems, rule) {
  assert.ok(
    rules(problems).has(rule),
    `expected ${rule}; received:\n${problems.map(formatIssue).join("\n")}`
  );
  for (const problem of problems) {
    assert.ok(problem.file);
    assert.ok(problem.line >= 1);
    assert.ok(problem.rule);
    assert.ok(problem.correction);
  }
}

function markdown(body, frontmatter = "title: Example") {
  return `---\n${frontmatter}\n---\n${body}\n`;
}

function encodeRepeatedly(value, rounds) {
  let encoded = value;
  for (let index = 0; index < rounds; index += 1) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

test("accepts the current complete Pages CMS configuration", () => {
  assert.deepEqual(validatePagesConfigSource(currentConfig), []);

  const displayOnlyChange = currentConfig
    .replace("label: Images", "label: Approved images")
    .replace(
      "Use an http(s) URL or leave this blank.",
      "Enter an approved web link or leave blank."
    );
  assert.deepEqual(validatePagesConfigSource(displayOnlyChange), []);
});

test("rejects every unapproved Pages CMS capability mutation", () => {
  const fixtures = [
    [
      "added file",
      `${currentConfig}\n  - name: extra_file\n    type: file\n    path: README.md\n    format: yaml\n    fields: []\n`
    ],
    [
      "added collection",
      `${currentConfig}\n  - name: extra_collection\n    type: collection\n    path: docs\n    fields: []\n`
    ],
    [
      "changed site settings",
      currentConfig.replace("path: src/data/site.json", "path: src/data/other.json")
    ],
    [
      "non-body rich text",
      currentConfig.replace(
        "name: description\n        label: Site description\n        type: text",
        "name: description\n        label: Site description\n        type: rich-text"
      )
    ],
    [
      "nested rich text",
      currentConfig.replace(
        "name: imageAlt\n            label: Hero image alt text\n            type: string",
        "name: imageAlt\n            label: Hero image alt text\n            type: rich-text"
      )
    ],
    [
      "component rich text",
      currentConfig.replace(
        "format: markdown\n          switcher: false\n          media: images",
        "format: markdown\n          switcher: false\n          components: [LocationMap]\n          media: images"
      )
    ],
    [
      "missing rich-text switcher lock",
      currentConfig.replace("          switcher: false\n", "")
    ],
    [
      "enabled rich-text source switcher",
      currentConfig.replace("switcher: false", "switcher: true")
    ],
    [
      "changed review action workflow",
      currentConfig.replace("workflow: cms-review.yml", "workflow: unsafe.yml")
    ],
    [
      "changed review action identity",
      currentConfig.replace("name: open-review-pr", "name: publish-now")
    ],
    [
      "changed review action label",
      currentConfig.replace("label: Open review PR", "label: Publish")
    ],
    [
      "changed review action ref",
      currentConfig.replace("ref: main", "ref: current")
    ],
    [
      "changed review action confirmation",
      currentConfig.replace(
        "This change is not published. It still requires checks, preview, approval, and human merge.",
        "Publish now."
      )
    ],
    [
      "removed review action confirmation",
      currentConfig.replace(
        /    confirm:\n      title: Open review PR\?\n      message: .*\n      button: Open review PR\n/,
        "    confirm: false\n"
      )
    ],
    [
      "added review action",
      currentConfig.replace(
        "\nmedia:\n",
        "\n  - name: extra-action\n    label: Extra action\n    workflow: unsafe.yml\n    ref: main\n\nmedia:\n"
      )
    ],
    ["HTML rich text", currentConfig.replace("format: markdown", "format: html")],
    [
      "missing settings root",
      currentConfig.replace(/^settings:[\s\S]*?\nactions:/, "actions:")
    ],
    ["extra root", `${currentConfig}\nplugins: [dangerous]\n`],
    ["display-like extra root", `${currentConfig}\nlabel: Unsafe extra root\n`],
    [
      "changed image media root",
      currentConfig.replace("input: public/uploads/images", "input: public")
    ],
    [
      "changed document extension",
      currentConfig.replace("extensions: [pdf]", "extensions: [pdf, html]")
    ],
    [
      "changed operations",
      currentConfig.replace("create: false\n      delete: false", "create: true\n      delete: false")
    ],
    [
      "nested body exposure",
      currentConfig.replace(
        "name: imageAlt\n            label: Hero image alt text\n            type: string",
        "name: body\n            label: Nested body\n            type: rich-text\n            options:\n              format: markdown"
      )
    ]
  ];

  for (const [name, fixture] of fixtures) {
    assertFailsWith(
      validatePagesConfigSource(fixture, `config-${name}.yml`),
      "pages-config/capability-allowlist"
    );
  }
});

test("rejects unsafe YAML constructs in Pages CMS configuration", () => {
  const fixtures = [
    ["duplicate", currentConfig.replace("settings:", "settings:\n  content: false"), "yaml/duplicate-key"],
    ["alias", currentConfig.replace("merge: true", "merge: &enabled true\n    copied: *enabled"), "yaml/alias"],
    ["merge", currentConfig.replace("content:\n    merge: true", "content:\n    <<: { merge: true }"), "yaml/merge-key"],
    ["tag", currentConfig.replace("merge: true", "merge: !unsafe true"), "yaml/custom-tag"],
    ["non-string key", `${currentConfig}\n1: value\n`, "yaml/string-key"],
    ["multiple docs", `${currentConfig}\n---\nextra: true\n`, "yaml/single-document"],
    ["unsupported key shape", `${currentConfig}\n? [one, two]\n: value\n`, "yaml/mapping-shape"]
  ];

  for (const [name, fixture, rule] of fixtures) {
    assertFailsWith(validatePagesConfigSource(fixture, `${name}.yml`), rule);
  }
});

test("strict YAML parsing rejects multiple documents directly", () => {
  assertFailsWith(
    parseStrictYaml("one: 1\n---\ntwo: 2\n", { file: "multi.yml" }).issues,
    "yaml/single-document"
  );
});

test("requires exact frontmatter delimiters and strict mappings", () => {
  const fixtures = [
    ["title: Missing opening\n", "frontmatter/opening-delimiter"],
    ["---\ntitle: Missing closing\n", "frontmatter/closing-delimiter"],
    [markdown("Text", "title: One\ntitle: Two"), "yaml/duplicate-key"],
    [markdown("Text", "title: &title One\nother: *title"), "yaml/alias"],
    [markdown("Text", "base: &base { title: One }\n<<: *base"), "yaml/merge-key"],
    [markdown("Text", "title: !unsafe One"), "yaml/custom-tag"],
    [markdown("Text", "1: value"), "yaml/string-key"],
    [markdown("Text", "- title\n- value"), "yaml/root-mapping"]
  ];

  for (const [source, rule] of fixtures) {
    assertFailsWith(validateMarkdownSource(source, "fixture.md").issues, rule);
  }
});

test("accepts the documented editor-native Markdown subset", () => {
  const body = [
    "# Heading",
    "",
    "Paragraph with *emphasis*, **strong text**, escaped punctuation \\{like this\\},",
    "an [HTTP link](https://example.com/path?q=one), a [mail link](mailto:editor@example.com),",
    "a [relative link](../news), a [root link](/faq), and a [fragment](#heading).  ",
    "This follows a hard break.",
    "",
    "![Approved image](/uploads/images/photo-1.webp)",
    "",
    "> Blockquote",
    "",
    "- one",
    "- two",
    "",
    "---",
    "",
    "Visit <https://example.com> or <editor@example.com>.",
    "",
    "Inline code: `<Badge>unsafe</Badge>`",
    "",
    "```html",
    "<iframe src=\"unsafe\"></iframe>",
    "```",
    "",
    "An ordinary comparison: Alpha < Beta > Gamma and α < β > γ.",
    "Normal prose may say import, export, :note[example], :::warning, or {example}.",
    "Escaped raw-tag example: \\<Badge>example\\</Badge>."
  ].join("\n");

  assert.deepEqual(validateMarkdownSource(markdown(body), "safe.md").issues, []);
});

test("rejects raw HTML in both maintained Markdown parsers", () => {
  const fixtures = [
    "<section>unsafe</section>",
    "<iframe src=\"https://example.com\"></iframe>",
    "<details><summary>Unsafe</summary>Body</details>",
    "Text <Badge>unsafe</Badge>",
    "<!-- comment -->",
    "<!doctype html>"
  ];

  for (const body of fixtures) {
    assertFailsWith(
      validateMarkdownSource(markdown(body), "unsafe-html.md").issues,
      "markdown/html"
    );
  }

  const positioned = validateMarkdownSource(
    markdown("First line\nSecond <Badge>unsafe</Badge>"),
    "positioned.md"
  ).issues;
  assert.equal(positioned.length, 1);
  assert.equal(positioned[0].line, 5);
});

test("rejects Marked features outside the approved editor-native subset", () => {
  const fixtures = [
    "~~strikethrough~~",
    "| A | B |\n| - | - |\n| 1 | 2 |",
    "- [x] task item"
  ];

  for (const body of fixtures) {
    assertFailsWith(
      validateMarkdownSource(markdown(body), "unsupported.md").issues,
      "markdown/editor-native"
    );
  }
});

test("treats JavaScript-like delimiters and import/export wording as prose", () => {
  const safeBodies = [
    "Render {items.map(renderItem)} here.",
    "Render { foo +\nbar } here.",
    ":note[ordinary text]",
    ":::warning\nordinary text\n:::",
    "import Map from './Map.astro'",
    "export default function() {}",
    "export class goods improve trade",
    "Alpha < Beta > Gamma",
    "α < β >= -γ",
    "Alpha < Beta\n\nLater, 3 > 1.",
    "`{ code } <Badge>code</Badge> import value`",
    "```mdx\n{ code }\n<Badge>code</Badge>\nexport default value\n```"
  ];

  for (const body of safeBodies) {
    assert.deepEqual(
      validateMarkdownSource(markdown(body), "ordinary-prose.md").issues,
      [],
      body
    );
  }
});

test("caps diagnostics and rejects oversized CMS Markdown before parsing", () => {
  const repeatedHtml = "<Badge>unsafe</Badge>\n\n".repeat(
    CMS_MARKDOWN_LIMITS.maxDiagnostics * 3
  );
  const diagnostics = validateMarkdownSource(
    markdown(repeatedHtml),
    "many-diagnostics.md"
  ).issues;

  assert.equal(diagnostics.length, CMS_MARKDOWN_LIMITS.maxDiagnostics);
  assert.ok(diagnostics.every((problem) => problem.rule === "markdown/html"));

  const oversized = markdown("x".repeat(CMS_MARKDOWN_LIMITS.maxBytes));
  assertFailsWith(
    validateMarkdownSource(oversized, "oversized.md").issues,
    "markdown/file-size"
  );
});

test("bounds large valid and unmatched-delimiter inputs", { timeout: 15_000 }, () => {
  const largeValid = "Ordinary editor-native prose.\n".repeat(7_500);
  assert.ok(Buffer.byteLength(markdown(largeValid)) < CMS_MARKDOWN_LIMITS.maxBytes);
  assert.deepEqual(
    validateMarkdownSource(markdown(largeValid), "large-valid.md").issues,
    []
  );

  const unmatched = `${"{".repeat(100_000)}\n${"<".repeat(100_000)}`;
  assert.ok(Buffer.byteLength(markdown(unmatched)) < CMS_MARKDOWN_LIMITS.maxBytes);
  const started = performance.now();
  const problems = validateMarkdownSource(markdown(unmatched), "unmatched.md").issues;
  const elapsed = performance.now() - started;

  assert.deepEqual(problems, []);
  assert.ok(elapsed < 10_000, `unmatched input took ${elapsed.toFixed(0)}ms`);
});

test("validates inline, reference, image, definition, and autolink destinations", () => {
  const safeBodies = [
    "[web](http://example.com) [secure](HTTPS://example.com) [mail](mailto:editor@example.com)",
    "[root](/news) [relative](news/item) [parent](../faq) [fragment](#faq)",
    "[reference][safe]\n\n[safe]: https://example.com/path",
    "![inline](/uploads/images/photo_1.JPEG)",
    "![reference][logo]\n\n[logo]: /uploads/images/logo.png",
    "<https://example.com/path> <editor@example.com>",
    `[encoded web](${encodeRepeatedly("https://example.com/safe-path", 6)})`,
    `[encoded mail](${encodeRepeatedly("mailto:editor@example.com", 5)})`,
    `[encoded root](${encodeRepeatedly("/news/safe-path", 5)})`,
    `[encoded fragment](${encodeRepeatedly("#faq", 5)})`,
    "[encoded unicode](https://example.com/%E2%9C%93)"
  ];
  for (const body of safeBodies) {
    assert.deepEqual(validateMarkdownSource(markdown(body), "safe-link.md").issues, []);
  }

  const unsafeLinks = [
    "[x](javascript:alert(1))",
    "[x](data:text/html,unsafe)",
    "[x](vbscript:msgbox(1))",
    "[x](//example.com/path)",
    "[x](JaVaScRiPt:alert(1))",
    "[x](jav&#x61;script:alert(1))",
    "[x](java%73cript:alert(1))",
    "[x](java%0ascript:alert(1))",
    "[x](java%20script:alert(1))",
    "[x](javascript%2525253Aalert(1))",
    `[x](${encodeRepeatedly("javascript:alert", 6)})`,
    `[x](${encodeRepeatedly("javascript:alert", 20)})`,
    "[x](https://)",
    "[x](bad%zz)",
    "[x][bad]\n\n[bad]: javascript:alert(1)",
    "<javascript:alert>"
  ];
  for (const body of unsafeLinks) {
    assertFailsWith(
      validateMarkdownSource(markdown(body), "unsafe-link.md").issues,
      "markdown/link-destination"
    );
  }

  const unsafeImages = [
    "![x](https://example.com/image.png)",
    "![x](//example.com/image.png)",
    "![x](/uploads/images/../secret.png)",
    "![x](/uploads/images/%2e%2e%2fsecret.png)",
    "![x](/uploads/images/folder%2fphoto.png)",
    "![x](/uploads/images/photo.svg)",
    "![x](/uploads/images/photo.png?raw=1)",
    "![x](/uploads/images/photo.png#large)",
    "![x][external]\n\n[external]: https://example.com/photo.png"
  ];
  for (const body of unsafeImages) {
    assertFailsWith(
      validateMarkdownSource(markdown(body), "unsafe-image.md").issues,
      "markdown/image-destination"
    );
  }
});

function makeFixedRepository(transform = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "cms-content-"));
  mkdirSync(join(root, "src/content/pages"), { recursive: true });
  mkdirSync(join(root, "src/content/faqs"), { recursive: true });
  mkdirSync(join(root, "src/content/resources"), { recursive: true });
  writeFileSync(join(root, ".pages.yml"), currentConfig);

  const fixed = {
    "home.md": "/",
    "who-we-are.md": "/who-we-are",
    "get-involved.md": "/get-involved",
    "news.md": "/news",
    "faq.md": "/faq"
  };
  for (const [filename, route] of Object.entries(fixed)) {
    writeFileSync(
      join(root, "src/content/pages", filename),
      markdown("Safe body", `title: ${filename}\nroute: ${route}`)
    );
  }
  transform(root);
  return root;
}

test("locks the exact fixed-page filename and route mapping", () => {
  const valid = makeFixedRepository();
  try {
    assert.deepEqual(checkRepository(valid), []);
  } finally {
    rmSync(valid, { recursive: true, force: true });
  }

  const fixtures = [
    [
      "missing",
      (root) => rmSync(join(root, "src/content/pages/news.md")),
      "fixed-pages/missing-file"
    ],
    [
      "extra",
      (root) => writeFileSync(join(root, "src/content/pages/extra.md"), markdown("Extra", "title: Extra\nroute: /extra")),
      "fixed-pages/extra-file"
    ],
    [
      "wrong route",
      (root) => writeFileSync(join(root, "src/content/pages/faq.md"), markdown("FAQ", "title: FAQ\nroute: /questions")),
      "fixed-pages/route-map"
    ],
    [
      "duplicate route",
      (root) => writeFileSync(join(root, "src/content/pages/faq.md"), markdown("FAQ", "title: FAQ\nroute: /news")),
      "fixed-pages/duplicate-route"
    ]
  ];

  for (const [, transform, rule] of fixtures) {
    const root = makeFixedRepository(transform);
    try {
      assertFailsWith(checkRepository(root), rule);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("caps diagnostics across the complete repository scan", () => {
  const root = makeFixedRepository((fixtureRoot) => {
    for (let index = 0; index < CMS_MARKDOWN_LIMITS.maxDiagnostics * 2; index += 1) {
      writeFileSync(
        join(fixtureRoot, "src/content/faqs", `unsafe-${index}.md`),
        markdown("<Badge>unsafe</Badge>", `question: Unsafe ${index}`)
      );
    }
  });

  try {
    assert.equal(checkRepository(root).length, CMS_MARKDOWN_LIMITS.maxDiagnostics);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real repository content and configuration pass", () => {
  assert.deepEqual(checkRepository(repositoryRoot.pathname), []);
});
