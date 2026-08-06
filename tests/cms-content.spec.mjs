import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
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
        "format: markdown\n          media: images",
        "format: markdown\n          components: [LocationMap]\n          media: images"
      )
    ],
    ["HTML rich text", currentConfig.replace("format: markdown", "format: html")],
    ["missing settings root", currentConfig.replace(/^settings:[\s\S]*?\nmedia:/, "media:")],
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

test("accepts the documented safe Markdown subset", () => {
  const body = [
    "# Heading",
    "",
    "Paragraph with *emphasis*, **strong text**, escaped punctuation \\{like this\\},",
    "an [HTTP link](https://example.com/path?q=one), a [mail link](mailto:editor@example.com),",
    "a [relative link](../news), a [root link](/faq), and a [fragment](#heading).",
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
    "Inline code: `<Component value={unsafe} />`",
    "",
    "```astro",
    "<Component value={unsafe} />",
    ":::not-a-container-inside-code",
    "```",
    "",
    "An ordinary comparison: 1 < 2 and 3 > 1.",
    "Escaped examples: \\<Component /> and \\:note[example]."
  ].join("\n");

  assert.deepEqual(validateMarkdownSource(markdown(body), "safe.md").issues, []);
});

test("rejects HTML, MDX, JSX/Astro, expressions, directives, and containers", () => {
  const fixtures = [
    ["<section>unsafe</section>", "markdown/html"],
    ["<!-- comment -->", "markdown/html"],
    ["<!doctype html>", "markdown/html"],
    ["<Component client:load />", "markdown/html"],
    ["<>fragment</>", "markdown/jsx"],
    ["import Map from './Map.astro'", "markdown/mdx-esm"],
    ["export const value = true", "markdown/mdx-esm"],
    ["export/**/default 1", "markdown/mdx-esm"],
    ["import{Map}from './Map.astro'", "markdown/mdx-esm"],
    ["Render {items.map(renderItem)} here.", "markdown/expression"],
    ["Render { foo +\nbar } here.", "markdown/expression"],
    ["Render {} here.", "markdown/expression"],
    ["<foo.Bar />", "markdown/jsx"],
    ["<foo:Bar />", "markdown/jsx"],
    ["<foo.Bar\n  prop=\"value\" />", "markdown/jsx"],
    ["<\nComponent>unsafe</\nComponent>", "markdown/jsx"],
    [`${"\\"}<Component>unsafe</\nComponent>`, "markdown/jsx"],
    ["<Δ />", "markdown/jsx"],
    ["<δ.Μέλος />", "markdown/jsx"],
    ["<δ:Μέλος />", "markdown/jsx"],
    [":note[unsafe]", "markdown/directive"],
    ["(:note[unsafe])", "markdown/directive"],
    ["Text:note[unsafe]", "markdown/directive"],
    ["(:note)", "markdown/directive"],
    ["Text —:note[unsafe]", "markdown/directive"],
    ["::warning unsafe", "markdown/directive"],
    [":::warning\nunsafe\n:::", "markdown/custom-container"],
    ["> :::warning\n> unsafe\n> :::", "markdown/custom-container"],
    ["- :::warning\n  unsafe\n  :::", "markdown/custom-container"],
    ["> 1. :::warning\n>    unsafe\n>    :::", "markdown/custom-container"]
  ];

  for (const [body, rule] of fixtures) {
    assertFailsWith(validateMarkdownSource(markdown(body), "unsafe.md").issues, rule);
  }
});

test("uses odd/even backslash parity and ignores complete code ranges", () => {
  const oddEscapes = [
    `Literal ${"\\"}{ foo +\nbar }`,
    `Literal ${"\\"}<foo.Bar />`,
    `Literal ${"\\"}<foo:Bar />`,
    `${"\\"}<\nComponent>literal${"\\"}</\nComponent>`,
    `Literal ${"\\"}<Δ />`,
    `Literal ${"\\"}<δ.Μέλος /> and ${"\\"}<δ:Μέλος />`,
    `Literal ${"\\"}:note[example]`,
    `Literal (${"\\"}:note[example])`,
    `Literal text${"\\"}:note[example]`,
    `${"\\"}:::literal container marker`,
    `> ${"\\"}:::literal container marker`,
    `- ${"\\"}:::literal container marker`,
    "exported values are prose",
    "export-ready values are prose",
    "importantly, this is prose",
    "We export/**/default wording as prose.",
    "Ordinary colon uses: https://example.com, 12:30, and key: value.",
    "Literal namespace:name without directive payload.",
    "`{ unsafe +\nlooking } <foo.Bar /> <Δ /> (:note[unsafe]) export/**/default 1`",
    "```mdx\n{ unsafe +\nlooking }\n<foo:Bar />\n<\nComponent>unsafe</\nComponent>\n<Δ />\n(:note[unsafe])\n> :::warning\n> unsafe\n> :::\nexport/**/default 1\n```",
    "> ```md\n> :::warning\n> fenced example\n> :::\n> ```",
    "- ```md\n  :::warning\n  fenced example\n  :::\n  ```"
  ];
  for (const body of oddEscapes) {
    assert.deepEqual(
      validateMarkdownSource(markdown(body), "escaped.md").issues,
      [],
      body
    );
  }

  const evenEscapes = [
    [`Literal ${"\\".repeat(2)}{ foo +\nbar }`, "markdown/expression"],
    [`Literal ${"\\".repeat(2)}<foo.Bar />`, "markdown/jsx"],
    [`Literal ${"\\".repeat(2)}<foo:Bar />`, "markdown/jsx"],
    [`${"\\".repeat(2)}<\nComponent>unsafe</\nComponent>`, "markdown/jsx"],
    [`Literal ${"\\".repeat(2)}<Δ />`, "markdown/jsx"],
    [`Literal ${"\\".repeat(2)}:note[example]`, "markdown/directive"],
    [`Literal (${"\\".repeat(2)}:note[example])`, "markdown/directive"],
    [`Literal text${"\\".repeat(2)}:note[example]`, "markdown/directive"],
    [`${"\\".repeat(2)}:::active container marker`, "markdown/custom-container"],
    [`> ${"\\".repeat(2)}:::active container marker`, "markdown/custom-container"],
    [`- ${"\\".repeat(2)}:::active container marker`, "markdown/custom-container"]
  ];
  for (const [body, rule] of evenEscapes) {
    assertFailsWith(validateMarkdownSource(markdown(body), "even.md").issues, rule);
  }
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

test("real repository content and configuration pass", () => {
  assert.deepEqual(checkRepository(repositoryRoot.pathname), []);
});
