import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  expectedDocumentTitle,
  loadCmsExpectations,
  normalizeRenderedTypography,
  requirePageExpectation
} from "./helpers/cms-expectations.ts";

function write(root: string, path: string, contents: string) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function markdown(frontmatter: string, body = "Fixture body.") {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

const fixtureParagraph = {
  tagName: "p",
  authoredTextSegments: ["Fixture body."],
  authoredLinkHrefs: [],
  authoredImages: []
};

const fixtureBody = {
  renderable: true,
  renderedBlockCount: 1,
  blocks: [fixtureParagraph]
};

const emptyBody = {
  renderable: false,
  renderedBlockCount: 0,
  blocks: []
};

test("normalizes Astro smart typography without changing prose meaning", () => {
  const source = `"Double" and 'single' plus ''backticks'', foo -- bar, . . ., ..., and .....`;
  const rendered = `“Double” and ‘single’ plus ”backticks”, foo — bar, …, …, and …`;

  assert.equal(
    normalizeRenderedTypography(source),
    normalizeRenderedTypography(rendered)
  );
});

function writeFixture(root: string) {
  write(
    root,
    "src/data/site.json",
    JSON.stringify({
      name: "Fixture Fraternity",
      description: "Fixture description.",
      homeHero: {},
      contact: {
        name: "Fixture Contact",
        email: "fixture@example.com",
        phone: "1112223333"
      }
    })
  );
  write(
    root,
    "src/content/pages/home.md",
    markdown(
      "title: Fixture Home\nroute: /\nnavLabel: Home\nnavOrder: 20",
      "## Editor heading\n\nBody with a [nested link](https://example.com).\n\n![Inline fixture](/uploads/images/fixture.webp)"
    )
  );
  write(
    root,
    "src/content/pages/faq.md",
    markdown(
      "title: Fixture Questions\nroute: /faq\nnavLabel: Questions\nnavOrder: 10",
      ""
    )
  );
  write(
    root,
    "src/content/faqs/nested/default-published.md",
    markdown("question: Default published question\norder: 20")
  );
  write(
    root,
    "src/content/faqs/published.md",
    markdown("question: Published question\norder: 10\npublished: true")
  );
  write(
    root,
    "src/content/faqs/unpublished.md",
    markdown("question: Hidden question\norder: 5\npublished: false")
  );
  write(
    root,
    "src/content/resources/nested/defaults.md",
    markdown(
      "title: Default resource\norder: 20\nexternalUrl: https://example.com/default.pdf"
    )
  );
  write(
    root,
    "src/content/resources/upload.md",
    markdown(
      "title: Uploaded resource\norder: 10\nlinkLabel: Download fixture\nuploadedFile: /uploads/documents/fixture.pdf\nexternalUrl: https://example.com/fallback.pdf\npublished: true",
      ""
    )
  );
  write(
    root,
    "src/content/resources/nested/text-only.md",
    markdown(
      "title: Text-only resource\norder: 30",
      "Body with an editor-authored [nested link][body-link] and [empty link][empty-link].\n\n![Reference fixture][body-image]\n\n[body-link]: https://example.com/body\n[empty-link]: <>\n[body-image]: /uploads/images/reference.png"
    )
  );
  write(
    root,
    "src/content/resources/unpublished.md",
    markdown(
      "title: Hidden resource\norder: 5\nexternalUrl: https://example.com/hidden.pdf\npublished: false"
    )
  );
}

test("CMS expectations follow isolated source mutations and schema defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "cms-expectations-"));

  try {
    writeFixture(root);

    const initial = loadCmsExpectations(root);
    assert.equal(initial.site.contact.phone, "1112223333");
    assert.equal(initial.site.name, "Fixture Fraternity");
    const initialHome = requirePageExpectation(initial, "/");
    const initialFaqPage = requirePageExpectation(initial, "/faq");
    assert.equal(initialHome.title, "Fixture Home");
    assert.deepEqual(initialHome.body, {
      renderable: true,
      renderedBlockCount: 3,
      blocks: [
        {
          tagName: "h2",
          authoredTextSegments: ["Editor heading"],
          authoredLinkHrefs: [],
          authoredImages: []
        },
        {
          tagName: "p",
          authoredTextSegments: ["Body with a ", "nested link", "."],
          authoredLinkHrefs: ["https://example.com"],
          authoredImages: []
        },
        {
          tagName: "p",
          authoredTextSegments: [],
          authoredLinkHrefs: [],
          authoredImages: [
            { src: "/uploads/images/fixture.webp", alt: "Inline fixture" }
          ]
        }
      ]
    });
    assert.deepEqual(initialFaqPage.body, emptyBody);
    assert.deepEqual(
      initial.pages.map(({ navLabel }) => navLabel),
      ["Questions", "Home"]
    );
    assert.deepEqual(
      initial.publishedFaqs.map(({ question, body }) => [question, body]),
      [
        [
          "Published question",
          fixtureBody
        ],
        [
          "Default published question",
          fixtureBody
        ]
      ]
    );
    assert.deepEqual(
      initial.publishedResources.map(
        ({ title, renderedLinkLabel, href, body }) => [
          title,
          renderedLinkLabel,
          href,
          body
        ]
      ),
      [
        [
          "Uploaded resource",
          "Download fixture",
          "/uploads/documents/fixture.pdf",
          emptyBody
        ],
        [
          "Default resource",
          "View Default resource",
          "https://example.com/default.pdf",
          fixtureBody
        ],
        [
          "Text-only resource",
          "View Text-only resource",
          "",
          {
            renderable: true,
            renderedBlockCount: 2,
            blocks: [
              {
                tagName: "p",
                authoredTextSegments: [
                  "Body with an editor-authored ",
                  "nested link",
                  " and ",
                  "empty link",
                  "."
                ],
                authoredLinkHrefs: ["https://example.com/body", ""],
                authoredImages: []
              },
              {
                tagName: "p",
                authoredTextSegments: [],
                authoredLinkHrefs: [],
                authoredImages: [
                  {
                    src: "/uploads/images/reference.png",
                    alt: "Reference fixture"
                  }
                ]
              }
            ]
          }
        ]
      ]
    );

    write(
      root,
      "src/data/site.json",
      JSON.stringify({
        name: "Mutated Fraternity",
        description: "Mutated description.",
        homeHero: { image: "", imageAlt: "" },
        contact: {
          name: "Mutated Contact",
          email: "mutated@example.com",
          phone: "9998887777"
        }
      })
    );
    write(
      root,
      "src/content/pages/home.md",
      markdown(
        "title: Mutated Home\nroute: /\nnavLabel: Start Here\nnavOrder: 5"
      )
    );
    write(
      root,
      "src/content/pages/faq.md",
      markdown(
        "title: Mutated Questions\nroute: /faq\nnavLabel: Answers\nnavOrder: 40"
      )
    );
    write(
      root,
      "src/content/faqs/nested/default-published.md",
      markdown(
        "question: Default published question\norder: 20\npublished: false"
      )
    );
    write(
      root,
      "src/content/resources/nested/defaults.md",
      markdown(
        "title: Default resource\norder: 20\nlinkLabel: Read the update\nuploadedFile: /uploads/documents/mutated.pdf\nexternalUrl: https://example.com/default.pdf"
      )
    );

    const mutated = loadCmsExpectations(root);
    const mutatedHome = requirePageExpectation(mutated, "/");
    const mutatedFaq = requirePageExpectation(mutated, "/faq");

    assert.equal(mutated.site.contact.phone, "9998887777");
    assert.equal(mutated.site.name, "Mutated Fraternity");
    assert.equal(mutatedHome.title, "Mutated Home");
    assert.equal(mutatedFaq.title, "Mutated Questions");
    assert.deepEqual(mutatedHome.body, fixtureBody);
    assert.equal(
      expectedDocumentTitle(mutatedHome.title, mutated.site.name),
      "Mutated Home | Mutated Fraternity"
    );
    assert.deepEqual(
      mutated.pages.map(({ route, navLabel }) => [route, navLabel]),
      [
        ["/", "Start Here"],
        ["/faq", "Answers"]
      ]
    );
    assert.deepEqual(
      mutated.publishedFaqs.map(({ question, body }) => [question, body]),
      [
        [
          "Published question",
          fixtureBody
        ]
      ]
    );
    assert.equal(mutated.publishedFaqs.length, 1);
    assert.deepEqual(
      mutated.publishedResources.map(
        ({ title, renderedLinkLabel, href, body }) => [
          title,
          renderedLinkLabel,
          href,
          body
        ]
      ),
      [
        [
          "Uploaded resource",
          "Download fixture",
          "/uploads/documents/fixture.pdf",
          emptyBody
        ],
        [
          "Default resource",
          "Read the update",
          "/uploads/documents/mutated.pdf",
          fixtureBody
        ],
        [
          "Text-only resource",
          "View Text-only resource",
          "",
          {
            renderable: true,
            renderedBlockCount: 2,
            blocks: [
              {
                tagName: "p",
                authoredTextSegments: [
                  "Body with an editor-authored ",
                  "nested link",
                  " and ",
                  "empty link",
                  "."
                ],
                authoredLinkHrefs: ["https://example.com/body", ""],
                authoredImages: []
              },
              {
                tagName: "p",
                authoredTextSegments: [],
                authoredLinkHrefs: [],
                authoredImages: [
                  {
                    src: "/uploads/images/reference.png",
                    alt: "Reference fixture"
                  }
                ]
              }
            ]
          }
        ]
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
