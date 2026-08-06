import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  APPROVED_LOCATION_MAP,
  checkBuiltSite
} from "../scripts/check-built-site.mjs";

function mapIframe(overrides = {}) {
  const attributes = { ...APPROVED_LOCATION_MAP, allowfullscreen: "", ...overrides };
  return `<iframe ${Object.entries(attributes)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => (value === "" ? name : `${name}="${value}"`))
    .join(" ")}></iframe>`;
}

function builtFixture({ who = mapIframe(), home = "<main>Home</main>" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "built-site-"));
  mkdirSync(join(root, "who-we-are"), { recursive: true });
  writeFileSync(join(root, "who-we-are/index.html"), `<!doctype html><body>${who}</body>`);
  writeFileSync(join(root, "index.html"), `<!doctype html><body>${home}</body>`);
  return root;
}

function rules(problems) {
  return new Set(problems.map((problem) => problem.rule));
}

test("accepts the exact approved built location map", () => {
  const root = builtFixture();
  try {
    assert.deepEqual(checkBuiltSite(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing, duplicate, and cross-page location maps", () => {
  const fixtures = [
    [builtFixture({ who: "<main>No map</main>" }), "built-site/map-count"],
    [builtFixture({ who: `${mapIframe()}${mapIframe()}` }), "built-site/map-count"],
    [builtFixture({ home: mapIframe() }), "built-site/map-page-boundary"]
  ];

  for (const [root, rule] of fixtures) {
    try {
      assert.ok(rules(checkBuiltSite(root)).has(rule));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects every changed approved map attribute", () => {
  const fixtures = [
    { title: "Wrong map" },
    { src: "https://www.google.com/maps/embed?pb=wrong" },
    { loading: "eager" },
    { referrerpolicy: "no-referrer" },
    { allowfullscreen: null }
  ];

  for (const override of fixtures) {
    const root = builtFixture({ who: mapIframe(override) });
    try {
      assert.ok(
        rules(checkBuiltSite(root)).has("built-site/map-attribute"),
        JSON.stringify(override)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
