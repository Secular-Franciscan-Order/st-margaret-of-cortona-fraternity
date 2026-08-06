import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument
} from "yaml";

const FIXED_PAGES = new Map([
  ["home.md", "/"],
  ["who-we-are.md", "/who-we-are"],
  ["get-involved.md", "/get-involved"],
  ["news.md", "/news"],
  ["faq.md", "/faq"]
]);

const CONTENT_ROOTS = [
  "src/content/pages",
  "src/content/faqs",
  "src/content/resources"
];

const CORE_YAML_TAGS = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float"
]);

const EXPECTED_PAGES_CONFIG = {
  settings: {
    content: { merge: true },
    commit: {
      identity: "app",
      templates: {
        create: "content(create): {path}",
        update: "content(update): {path}",
        delete: "content(delete): {path}",
        rename: "content(rename): {oldPath} -> {newPath}"
      }
    }
  },
  media: [
    {
      name: "images",
      input: "public/uploads/images",
      output: "/uploads/images",
      categories: ["image"],
      extensions: ["webp", "jpg", "jpeg", "png"],
      rename: "safe"
    },
    {
      name: "documents",
      input: "public/uploads/documents",
      output: "/uploads/documents",
      categories: ["document"],
      extensions: ["pdf"],
      rename: "safe"
    }
  ],
  content: [
    {
      name: "site_settings",
      type: "file",
      path: "src/data/site.json",
      format: "json",
      operations: { create: false, delete: false },
      fields: [
        { name: "name", type: "string", required: true },
        { name: "description", type: "text", required: true },
        {
          name: "homeHero",
          type: "object",
          required: true,
          fields: [
            {
              name: "image",
              type: "image",
              options: {
                media: "images",
                extensions: ["webp", "jpg", "jpeg", "png"],
                rename: "safe"
              }
            },
            { name: "imageAlt", type: "string" }
          ]
        },
        {
          name: "contact",
          type: "object",
          required: true,
          fields: [
            { name: "name", type: "string", required: true },
            { name: "email", type: "string", required: true },
            { name: "phone", type: "string", required: true }
          ]
        }
      ]
    },
    {
      name: "pages",
      type: "collection",
      path: "src/content/pages",
      format: "yaml-frontmatter",
      operations: { create: false, rename: false, delete: false },
      view: {
        primary: "title",
        sort: "navOrder",
        order: "asc",
        fields: ["route", "navLabel"]
      },
      fields: [
        { name: "title", type: "string", required: true },
        { name: "route", type: "string", required: true, readonly: true },
        { name: "navLabel", type: "string", required: true },
        { name: "navOrder", type: "number", required: true },
        { name: "description", type: "text" },
        {
          name: "body",
          type: "rich-text",
          options: {
            format: "markdown",
            media: "images",
            extensions: ["webp", "jpg", "jpeg", "png"],
            path: ".",
            rename: "safe"
          }
        }
      ]
    },
    {
      name: "faqs",
      type: "collection",
      path: "src/content/faqs",
      format: "yaml-frontmatter",
      filename: { template: "{primary}.md", field: "create" },
      view: {
        primary: "question",
        sort: "order",
        order: "asc",
        fields: ["published"]
      },
      fields: [
        { name: "question", type: "string", required: true },
        { name: "order", type: "number", required: true },
        { name: "published", type: "boolean" },
        {
          name: "body",
          type: "rich-text",
          options: {
            format: "markdown",
            media: "images",
            extensions: ["webp", "jpg", "jpeg", "png"],
            path: ".",
            rename: "safe"
          }
        }
      ]
    },
    {
      name: "resources",
      type: "collection",
      path: "src/content/resources",
      format: "yaml-frontmatter",
      filename: { template: "{primary}.md", field: "create" },
      view: {
        primary: "title",
        sort: "order",
        order: "asc",
        fields: ["published", "externalUrl", "uploadedFile"]
      },
      fields: [
        { name: "title", type: "string", required: true },
        { name: "order", type: "number", required: true },
        { name: "linkLabel", type: "string" },
        {
          name: "uploadedFile",
          type: "file",
          options: {
            media: "documents",
            extensions: ["pdf"],
            rename: "safe"
          }
        },
        {
          name: "externalUrl",
          type: "string",
          pattern: { regex: "^$|^https?://" }
        },
        { name: "published", type: "boolean" },
        {
          name: "body",
          type: "rich-text",
          options: {
            format: "markdown",
            media: "images",
            extensions: ["webp", "jpg", "jpeg", "png"],
            path: ".",
            rename: "safe"
          }
        }
      ]
    }
  ]
};

function issue(file, line, rule, message, correction) {
  return { file, line: Math.max(1, line || 1), rule, message, correction };
}

export function formatIssue(problem) {
  return `${problem.file}:${problem.line} [${problem.rule}] ${problem.message} Correction: ${problem.correction}`;
}

function yamlLine(node, lineCounter, baseLine) {
  const offset = Array.isArray(node?.range) ? node.range[0] : 0;
  return lineCounter.linePos(offset).line + baseLine - 1;
}

function parserRule(error) {
  const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();

  if (text.includes("multiple document")) return "yaml/single-document";
  if (text.includes("unique") || text.includes("duplicate")) {
    return "yaml/duplicate-key";
  }
  if (text.includes("tag")) return "yaml/custom-tag";
  if (text.includes("alias")) return "yaml/alias";
  return "yaml/parse";
}

function parserCorrection(rule) {
  const corrections = {
    "yaml/single-document": "Keep exactly one YAML document.",
    "yaml/duplicate-key": "Remove the duplicate mapping key.",
    "yaml/custom-tag": "Remove custom YAML tags and use plain core values.",
    "yaml/alias": "Expand aliases into explicit values.",
    "yaml/parse": "Fix the YAML syntax using plain mappings, sequences, and scalar values."
  };
  return corrections[rule];
}

function inspectYamlNode(node, context, problems) {
  const { file, lineCounter, baseLine } = context;
  const line = yamlLine(node, lineCounter, baseLine);

  if (isAlias(node)) {
    problems.push(
      issue(
        file,
        line,
        "yaml/alias",
        "YAML aliases are not allowed.",
        "Expand the aliased value explicitly."
      )
    );
    return;
  }

  if (node?.tag && !CORE_YAML_TAGS.has(node.tag)) {
    problems.push(
      issue(
        file,
        line,
        "yaml/custom-tag",
        `YAML tag ${node.tag} is not allowed.`,
        "Remove the tag and use a plain core YAML value."
      )
    );
  }

  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) {
        problems.push(
          issue(
            file,
            yamlLine(pair, lineCounter, baseLine),
            "yaml/mapping-shape",
            "Mapping entries must use scalar string keys.",
            "Replace the entry with a plain string key and supported value."
          )
        );
        continue;
      }

      if (typeof pair.key.value !== "string") {
        problems.push(
          issue(
            file,
            yamlLine(pair.key, lineCounter, baseLine),
            "yaml/string-key",
            "Mapping keys must be strings.",
            "Quote or replace the key with a plain string key."
          )
        );
      }

      if (pair.key.value === "<<") {
        problems.push(
          issue(
            file,
            yamlLine(pair.key, lineCounter, baseLine),
            "yaml/merge-key",
            "YAML merge keys are not allowed.",
            "Expand the merged mapping explicitly."
          )
        );
      }

      inspectYamlNode(pair.value, context, problems);
    }
    return;
  }

  if (isSeq(node)) {
    for (const item of node.items) inspectYamlNode(item, context, problems);
    return;
  }

  if (isScalar(node)) {
    if (
      node.value !== null &&
      !["string", "number", "boolean"].includes(typeof node.value)
    ) {
      problems.push(
        issue(
          file,
          line,
          "yaml/scalar-shape",
          "This YAML scalar type is not supported.",
          "Use a string, finite number, boolean, or null."
        )
      );
    }
    if (typeof node.value === "number" && !Number.isFinite(node.value)) {
      problems.push(
        issue(
          file,
          line,
          "yaml/scalar-shape",
          "Non-finite YAML numbers are not supported.",
          "Use a finite decimal number."
        )
      );
    }
    return;
  }

  if (node != null) {
    problems.push(
      issue(
        file,
        line,
        "yaml/node-shape",
        "This YAML node shape is not supported.",
        "Use only plain mappings, sequences, and scalar values."
      )
    );
  }
}

export function parseStrictYaml(
  source,
  { file = "<yaml>", baseLine = 1, requireMapping = true } = {}
) {
  const problems = [];
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    schema: "core",
    strict: true,
    uniqueKeys: true
  });

  for (const error of [...document.errors, ...document.warnings]) {
    const rule = parserRule(error);
    const reportedLine = error.linePos?.[0]?.line ?? 1;
    problems.push(
      issue(
        file,
        reportedLine + baseLine - 1,
        rule,
        String(error.message).split("\n")[0],
        parserCorrection(rule)
      )
    );
  }

  if (document.contents) {
    inspectYamlNode(
      document.contents,
      { file, lineCounter, baseLine },
      problems
    );
  }

  if (requireMapping && document.contents && !isMap(document.contents)) {
    problems.push(
      issue(
        file,
        baseLine,
        "yaml/root-mapping",
        "The YAML document root must be a mapping.",
        "Use named string keys at the document root."
      )
    );
  }

  let value;
  if (problems.length === 0) {
    try {
      value = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      problems.push(
        issue(
          file,
          baseLine,
          "yaml/conversion",
          error instanceof Error ? error.message : String(error),
          "Replace aliases, tags, or unsupported nodes with explicit core YAML values."
        )
      );
    }
  }

  return { document, value, issues: problems };
}

function canonicalize(value, path = []) {
  if (Array.isArray(value)) {
    return value.map((child, index) => canonicalize(child, [...path, index]));
  }
  if (!value || typeof value !== "object") return value;

  const namedDisplayObject =
    typeof value.name === "string" && ["media", "content"].includes(path[0]);
  const validationPattern = typeof value.regex === "string";

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !(namedDisplayObject && ["label", "description"].includes(key)) &&
          !(validationPattern && key === "message")
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child, [...path, key])])
  );
}

export function validatePagesConfigSource(source, file = ".pages.yml") {
  const parsed = parseStrictYaml(source, { file });
  const problems = [...parsed.issues];

  if (problems.length === 0) {
    const actual = JSON.stringify(canonicalize(parsed.value));
    const expected = JSON.stringify(canonicalize(EXPECTED_PAGES_CONFIG));

    if (actual !== expected) {
      problems.push(
        issue(
          file,
          1,
          "pages-config/capability-allowlist",
          "Pages CMS behavior or ownership capabilities differ from the approved configuration.",
          "Restore the exact approved settings, media roots/options, content entries, field tree, operations, and rich-text exposure; only display labels, descriptions, and validation messages may vary."
        )
      );
    }
  }

  return problems;
}

function decodedDestination(destination) {
  const maximumDecodingRounds = 16;
  let value = destination;

  for (let index = 0; index < maximumDecodingRounds; index += 1) {
    if (/%(?![0-9a-f]{2})/i.test(value)) {
      return { error: "contains malformed percent encoding" };
    }
    if (!/%[0-9a-f]{2}/i.test(value)) return { value };

    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return { value };
      value = decoded;
    } catch {
      return { error: "contains malformed percent encoding" };
    }
  }

  if (/%(?![0-9a-f]{2})/i.test(value)) {
    return { error: "contains malformed percent encoding" };
  }
  if (/%[0-9a-f]{2}/i.test(value)) {
    return { error: "exceeds the safe percent-decoding limit" };
  }

  return { value };
}

export function validateLinkDestination(destination) {
  if (typeof destination !== "string") return "is not a string";
  const decoded = decodedDestination(destination);
  if (decoded.error) return decoded.error;
  const value = decoded.value;

  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    return "contains a control character";
  }
  if (/\s/u.test(value)) return "contains disallowed whitespace";
  if (value.includes("\\")) return "contains a backslash";
  if (value.startsWith("//")) return "is protocol-relative";

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/iu.exec(value);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!["http", "https", "mailto"].includes(scheme)) {
      return `uses the disallowed ${scheme}: scheme`;
    }

    try {
      const url = new URL(value);
      if ((scheme === "http" || scheme === "https") && !url.hostname) {
        return "does not contain a valid HTTP(S) host";
      }
      if (scheme === "mailto" && !url.pathname) {
        return "does not contain a mail recipient";
      }
    } catch {
      return "is not a valid absolute URL";
    }
    return null;
  }

  try {
    const url = new URL(value, "https://cms.invalid/current/");
    if (url.protocol !== "https:" || url.hostname !== "cms.invalid") {
      return "is not a valid relative or fragment destination";
    }
  } catch {
    return "is not a valid relative or fragment destination";
  }

  return null;
}

export function validateImageDestination(destination) {
  if (typeof destination !== "string") return "is not a string";
  if (destination.includes("%")) return "contains percent encoding";
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(destination)) {
    return "contains a control character";
  }
  if (/\s/u.test(destination)) return "contains whitespace";
  if (destination.includes("\\")) return "contains a backslash";
  if (destination.includes("?") || destination.includes("#")) {
    return "contains a query string or fragment";
  }
  if (!/^\/uploads\/images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpe?g|png)$/i.test(destination)) {
    return "is not an approved uploaded-image path";
  }

  const filename = destination.slice("/uploads/images/".length);
  if (filename.includes("..")) return "contains traversal-like dot segments";
  return null;
}

function destinationIssue(file, line, kind, destination, reason) {
  const correction =
    kind === "image"
      ? "Use /uploads/images/<safe-filename>.(webp|jpg|jpeg|png) without traversal, encoding, query, or fragment."
      : "Use HTTP(S), mailto, a root/document-relative path, or a fragment without controls, whitespace, obfuscation, or an invalid URL form.";
  return issue(
    file,
    line,
    `markdown/${kind}-destination`,
    `${kind === "image" ? "Image" : "Link"} destination ${JSON.stringify(destination)} ${reason}.`,
    correction
  );
}

function sourceLine(node, bodyStartLine) {
  return (node.position?.start?.line ?? 1) + bodyStartLine - 1;
}

function precedingBackslashes(source, index) {
  let start = index;
  while (start > 0 && source[start - 1] === "\\") start -= 1;
  return { count: index - start, start };
}

function isEscaped(source, index) {
  return precedingBackslashes(source, index).count % 2 === 1;
}

function isMarkdownBlockPrefix(prefix) {
  return /^[ \t]{0,3}(?:(?:>[ \t]*)|(?:(?:[-+*]|\d{1,9}[.)])[ \t]+))*$/.test(
    prefix
  );
}

function sourceLineAtOffset(source, offset, bodyStartLine) {
  let line = bodyStartLine;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function maskNonScannableRanges(ast, body) {
  const masked = body.split("");

  function visit(node) {
    if (["code", "inlineCode", "html"].includes(node.type) && node.position) {
      const start = node.position.start.offset ?? 0;
      const end = node.position.end.offset ?? start;
      for (let index = start; index < end; index += 1) {
        if (masked[index] !== "\n") masked[index] = " ";
      }
      return;
    }
    for (const child of node.children || []) visit(child);
  }

  visit(ast);
  return masked.join("");
}

function addExcludedSyntaxIssue(
  problems,
  file,
  source,
  bodyStartLine,
  offset,
  rule,
  message,
  correction
) {
  problems.push(
    issue(
      file,
      sourceLineAtOffset(source, offset, bodyStartLine),
      rule,
      message,
      correction
    )
  );
}

function scanExcludedSyntax(ast, body, file, bodyStartLine, problems) {
  const source = maskNonScannableRanges(ast, body);

  const containerPattern = /:::/g;
  let match;
  while ((match = containerPattern.exec(source))) {
    const offset = match.index;
    const escapes = precedingBackslashes(source, offset);
    const lineStart = source.lastIndexOf("\n", escapes.start - 1) + 1;
    if (
      escapes.count % 2 === 0 &&
      isMarkdownBlockPrefix(source.slice(lineStart, escapes.start))
    ) {
      addExcludedSyntaxIssue(
        problems,
        file,
        source,
        bodyStartLine,
        offset,
        "markdown/custom-container",
        "Custom ::: containers are not allowed.",
        "Use an ordinary heading, paragraph, list, blockquote, or fenced code block."
      );
    }
  }

  const directivePattern =
    /:{1,2}[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?(?![A-Za-z0-9_-]|:)/g;
  while ((match = directivePattern.exec(source))) {
    const offset = match.index;
    const escapes = precedingBackslashes(source, offset);
    const before = escapes.start === 0 ? "" : source[escapes.start - 1];
    const hasPhrasingBoundary =
      before === "" || !/[:$_\u200C\u200D\p{ID_Continue}-]/u.test(before);
    const next = source[offset + match[0].length];
    const hasExplicitPayload = before !== ":" && (next === "[" || next === "{");
    if (
      escapes.count % 2 === 0 &&
      (hasPhrasingBoundary || hasExplicitPayload)
    ) {
      addExcludedSyntaxIssue(
        problems,
        file,
        source,
        bodyStartLine,
        offset,
        "markdown/directive",
        "Markdown directives are not allowed.",
        "Use ordinary Markdown, or escape the leading colon when it is literal text."
      );
    }
  }

  const esmPattern = /(^|\n)[ \t]{0,3}(import|export)(?=$|[^A-Za-z0-9_$-])/g;
  while ((match = esmPattern.exec(source))) {
    const offset = match.index + match[0].lastIndexOf(match[2]);
    addExcludedSyntaxIssue(
      problems,
      file,
      source,
      bodyStartLine,
      offset,
      "markdown/mdx-esm",
      "MDX import/export syntax is not allowed.",
      "Remove executable module syntax or put a non-executed example in code."
    );
  }

  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== "{" || isEscaped(source, offset)) continue;
    let depth = 1;
    let end = offset + 1;
    for (; end < source.length && depth > 0; end += 1) {
      if (isEscaped(source, end)) continue;
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") depth -= 1;
    }
    if (depth === 0) {
      addExcludedSyntaxIssue(
        problems,
        file,
        source,
        bodyStartLine,
        offset,
        "markdown/expression",
        "Executable expression syntax is not allowed.",
        "Remove the expression, escape literal braces, or put a non-executed example in code."
      );
      offset = end - 1;
    }
  }

  const jsxIdentifier = "[$_\\p{ID_Start}][$_\\u200C\\u200D\\p{ID_Continue}-]*";
  const jsxNamePattern = new RegExp(
    `^${jsxIdentifier}(?:[.:]${jsxIdentifier})*`,
    "u"
  );
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== "<" || isEscaped(source, offset)) continue;
    let nameStart = offset + 1;
    while (/\s/u.test(source[nameStart] || "")) nameStart += 1;
    if (source[nameStart] === "/") {
      nameStart += 1;
      while (/\s/u.test(source[nameStart] || "")) nameStart += 1;
    }
    if (source[nameStart] === ">") {
      addExcludedSyntaxIssue(
        problems,
        file,
        source,
        bodyStartLine,
        offset,
        "markdown/jsx",
        "JSX/Astro component syntax is not allowed.",
        "Remove the component markup or put a non-executed example in code."
      );
      continue;
    }

    const remainder = source.slice(nameStart);
    const name = jsxNamePattern.exec(remainder)?.[0];
    if (!name) continue;
    const boundary = remainder[name.length];
    const componentLike =
      !/^[a-z]/.test(name) || name.includes(".") || name.includes(":");
    if (componentLike && (boundary === undefined || /[\s/>]/u.test(boundary))) {
      addExcludedSyntaxIssue(
        problems,
        file,
        source,
        bodyStartLine,
        offset,
        "markdown/jsx",
        "JSX/Astro component syntax is not allowed.",
        "Remove the component markup or put a non-executed example in code."
      );
    }
  }
}

function inspectMarkdown(ast, body, file, bodyStartLine, problems) {
  const definitions = new Map();

  function collect(node) {
    if (node.type === "definition") {
      const identifier = node.identifier.toLowerCase();
      if (definitions.has(identifier)) {
        problems.push(
          issue(
            file,
            sourceLine(node, bodyStartLine),
            "markdown/duplicate-definition",
            `Duplicate reference definition ${JSON.stringify(node.identifier)} is ambiguous.`,
            "Keep one definition for each case-insensitive reference identifier."
          )
        );
      } else {
        definitions.set(identifier, node);
      }
      const reason = validateLinkDestination(node.url);
      if (reason) {
        problems.push(
          destinationIssue(
            file,
            sourceLine(node, bodyStartLine),
            "link",
            node.url,
            reason
          )
        );
      }
    }
    for (const child of node.children || []) collect(child);
  }
  collect(ast);

  function visit(node) {
    const line = sourceLine(node, bodyStartLine);

    if (node.type === "html") {
      problems.push(
        issue(
          file,
          line,
          "markdown/html",
          "HTML, comments, and declarations are not allowed in CMS Markdown.",
          "Use safe Markdown and move code-owned structure into an Astro component."
        )
      );
    } else if (node.type === "link") {
      const reason = validateLinkDestination(node.url);
      if (reason) {
        problems.push(destinationIssue(file, line, "link", node.url, reason));
      }
    } else if (node.type === "image") {
      const reason = validateImageDestination(node.url);
      if (reason) {
        problems.push(destinationIssue(file, line, "image", node.url, reason));
      }
    } else if (node.type === "linkReference" || node.type === "imageReference") {
      const definition = definitions.get(node.identifier.toLowerCase());
      if (!definition) {
        problems.push(
          issue(
            file,
            line,
            "markdown/unresolved-reference",
            `Reference ${JSON.stringify(node.identifier)} has no definition.`,
            "Add one safe reference definition or use an inline destination."
          )
        );
      } else {
        const kind = node.type === "imageReference" ? "image" : "link";
        const reason =
          kind === "image"
            ? validateImageDestination(definition.url)
            : validateLinkDestination(definition.url);
        if (reason) {
          problems.push(
            destinationIssue(file, line, kind, definition.url, reason)
          );
        }
      }
    }

    for (const child of node.children || []) visit(child);
  }
  visit(ast);
  scanExcludedSyntax(ast, body, file, bodyStartLine, problems);
}

export function validateMarkdownSource(source, file = "<markdown>") {
  const problems = [];
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    problems.push(
      issue(
        file,
        1,
        "frontmatter/opening-delimiter",
        "Markdown must begin with an exact --- frontmatter delimiter.",
        "Add --- on the first line before the YAML frontmatter."
      )
    );
    return { issues: problems, frontmatter: undefined, body: "" };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    problems.push(
      issue(
        file,
        1,
        "frontmatter/closing-delimiter",
        "Markdown frontmatter has no exact closing --- delimiter.",
        "Add a closing --- line before the Markdown body."
      )
    );
    return { issues: problems, frontmatter: undefined, body: "" };
  }

  const frontmatterSource = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  const bodyStartLine = closingIndex + 2;
  const parsed = parseStrictYaml(frontmatterSource, {
    file,
    baseLine: 2,
    requireMapping: true
  });
  problems.push(...parsed.issues);

  try {
    const ast = fromMarkdown(body);
    inspectMarkdown(ast, body, file, bodyStartLine, problems);
  } catch (error) {
    problems.push(
      issue(
        file,
        bodyStartLine,
        "markdown/parse",
        error instanceof Error ? error.message : String(error),
        "Fix the Markdown so it parses as CommonMark."
      )
    );
  }

  return {
    issues: problems,
    frontmatter: parsed.value,
    body,
    bodyStartLine
  };
}

function markdownFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
  }

  walk(root);
  return files.sort();
}

function toRepositoryPath(root, path) {
  return relative(root, path).split("\\").join("/");
}

function validateFixedPages(results) {
  const pagePrefix = "src/content/pages/";
  const actual = new Map(
    [...results.entries()].filter(([path]) => path.startsWith(pagePrefix))
  );

  for (const [filename, route] of FIXED_PAGES) {
    const path = `${pagePrefix}${filename}`;
    const result = actual.get(path);
    if (!result) {
      results.issues.push(
        issue(
          path,
          1,
          "fixed-pages/missing-file",
          `Required fixed page ${filename} is missing.`,
          `Restore ${path} with route ${route}.`
        )
      );
      continue;
    }
    if (result.frontmatter?.route !== route) {
      results.issues.push(
        issue(
          path,
          2,
          "fixed-pages/route-map",
          `Fixed page ${filename} must use route ${route}.`,
          `Set route: ${route} without renaming the file.`
        )
      );
    }
  }

  for (const path of actual.keys()) {
    const filename = path.slice(pagePrefix.length);
    if (!FIXED_PAGES.has(filename)) {
      results.issues.push(
        issue(
          path,
          1,
          "fixed-pages/extra-file",
          `Unapproved fixed-page file ${filename} is present.`,
          "Remove it or make an owner-approved code and route change outside Pages CMS."
        )
      );
    }
  }

  const routes = new Map();
  for (const [path, result] of actual) {
    const route = result.frontmatter?.route;
    if (typeof route !== "string") continue;
    if (routes.has(route)) {
      results.issues.push(
        issue(
          path,
          2,
          "fixed-pages/duplicate-route",
          `Route ${route} duplicates ${routes.get(route)}.`,
          "Restore the exact fixed filename-to-route mapping."
        )
      );
    } else {
      routes.set(route, path);
    }
  }
}

export function checkRepository(root = process.cwd()) {
  const repositoryRoot = resolve(root);
  const problems = [];
  const results = new Map();
  results.issues = problems;

  const configPath = resolve(repositoryRoot, ".pages.yml");
  try {
    problems.push(
      ...validatePagesConfigSource(readFileSync(configPath, "utf8"), ".pages.yml")
    );
  } catch (error) {
    problems.push(
      issue(
        ".pages.yml",
        1,
        "pages-config/read",
        error instanceof Error ? error.message : String(error),
        "Restore the approved readable .pages.yml configuration."
      )
    );
  }

  for (const contentRoot of CONTENT_ROOTS) {
    const absoluteRoot = resolve(repositoryRoot, contentRoot);
    let files;
    try {
      files = markdownFiles(absoluteRoot);
    } catch (error) {
      problems.push(
        issue(
          contentRoot,
          1,
          "content-root/read",
          error instanceof Error ? error.message : String(error),
          `Restore the readable ${contentRoot} content root.`
        )
      );
      continue;
    }

    for (const path of files) {
      const repositoryPath = toRepositoryPath(repositoryRoot, path);
      let result;
      try {
        result = validateMarkdownSource(
          readFileSync(path, "utf8"),
          repositoryPath
        );
      } catch (error) {
        problems.push(
          issue(
            repositoryPath,
            1,
            "content-file/read",
            error instanceof Error ? error.message : String(error),
            "Restore a readable regular Markdown file."
          )
        );
        continue;
      }
      results.set(repositoryPath, result);
      problems.push(...result.issues);
    }
  }

  validateFixedPages(results);
  return problems;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const problems = checkRepository();
  if (problems.length) {
    for (const problem of problems) console.error(formatIssue(problem));
    console.error(`CMS content guard failed with ${problems.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log("CMS content guard passed: configuration and CMS content are within the approved boundary.");
  }
}
