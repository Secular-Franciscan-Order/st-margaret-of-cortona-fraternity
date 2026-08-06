import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "parse5";

export const APPROVED_LOCATION_MAP = Object.freeze({
  title: "Map to St. Gabriel the Archangel Catholic Church",
  src: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3225.1709972320523!2d-115.12414712419509!3d36.064933072466!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x80c8cf8dbd7bbb27%3A0x79aa173c20f43d86!2sSt.%20Gabriel%20the%20Archangel%20Catholic%20Church!5e0!3m2!1sen!2sus!4v1782250735295!5m2!1sen!2sus",
  loading: "lazy",
  referrerpolicy: "strict-origin-when-cross-origin"
});

const MAP_PAGE = "who-we-are/index.html";

function builtIssue(file, rule, message, correction) {
  return { file, rule, message, correction };
}

export function formatBuiltIssue(problem) {
  return `${problem.file} [${problem.rule}] ${problem.message} Correction: ${problem.correction}`;
}

function htmlFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
    }
  }

  walk(root);
  return files.sort();
}

function attributes(node) {
  return new Map((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
}

function iframeElements(document) {
  const iframes = [];

  function visit(node) {
    if (node.tagName === "iframe") iframes.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }

  visit(document);
  return iframes;
}

function isLocationMap(attributesByName) {
  return (
    attributesByName.get("title") === APPROVED_LOCATION_MAP.title ||
    (attributesByName.get("src") || "").startsWith(
      "https://www.google.com/maps/embed"
    )
  );
}

export function checkBuiltSite(root = "dist") {
  const buildRoot = resolve(root);
  const problems = [];
  let files;

  try {
    files = htmlFiles(buildRoot);
  } catch (error) {
    return [
      builtIssue(
        "dist/",
        "built-site/read",
        error instanceof Error ? error.message : String(error),
        "Run the static build and provide its readable dist directory."
      )
    ];
  }

  const pages = new Map();
  for (const path of files) {
    const file = relative(buildRoot, path).split("\\").join("/");
    try {
      const document = parse(readFileSync(path, "utf8"));
      pages.set(
        file,
        iframeElements(document).map((iframe) => attributes(iframe))
      );
    } catch (error) {
      problems.push(
        builtIssue(
          file,
          "built-site/parse",
          error instanceof Error ? error.message : String(error),
          "Restore readable, parseable static HTML output."
        )
      );
    }
  }

  const mapPageIframes = pages.get(MAP_PAGE);
  if (!mapPageIframes) {
    problems.push(
      builtIssue(
        MAP_PAGE,
        "built-site/map-page",
        "The built Who We Are page is missing.",
        "Restore the /who-we-are static route and rebuild."
      )
    );
    return problems;
  }

  const mapIframes = mapPageIframes.filter(isLocationMap);
  if (mapIframes.length !== 1) {
    problems.push(
      builtIssue(
        MAP_PAGE,
        "built-site/map-count",
        `Expected exactly one approved location map iframe; found ${mapIframes.length}.`,
        "Render the code-owned LocationMap component exactly once on /who-we-are."
      )
    );
  } else {
    const map = mapIframes[0];
    for (const [attribute, expected] of Object.entries(APPROVED_LOCATION_MAP)) {
      if (map.get(attribute) !== expected) {
        problems.push(
          builtIssue(
            MAP_PAGE,
            "built-site/map-attribute",
            `Location map ${attribute} must be ${JSON.stringify(expected)}.`,
            "Restore the approved code-owned LocationMap iframe attributes."
          )
        );
      }
    }
    if (!map.has("allowfullscreen")) {
      problems.push(
        builtIssue(
          MAP_PAGE,
          "built-site/map-attribute",
          "Location map must include allowfullscreen.",
          "Restore the approved code-owned LocationMap iframe attributes."
        )
      );
    }
  }

  for (const [file, iframes] of pages) {
    if (file === MAP_PAGE) continue;
    const count = iframes.filter(isLocationMap).length;
    if (count > 0) {
      problems.push(
        builtIssue(
          file,
          "built-site/map-page-boundary",
          `Found ${count} location map iframe(s) outside /who-we-are.`,
          "Render the code-owned LocationMap component only on /who-we-are."
        )
      );
    }
  }

  return problems;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const problems = checkBuiltSite(process.argv[2] || "dist");
  if (problems.length) {
    for (const problem of problems) console.error(formatBuiltIssue(problem));
    console.error(`Built-site guard failed with ${problems.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log("Built-site guard passed: the approved location map invariant is intact.");
  }
}
