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

const javascriptIdentifierPattern =
  /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*/u;
const jsxIdentifier = "[$_\\p{ID_Start}][$_\\u200C\\u200D\\p{ID_Continue}-]*";
const jsxNamePattern = new RegExp(
  `^${jsxIdentifier}(?:[.:]${jsxIdentifier})*`,
  "u"
);

function readJavascriptIdentifier(source, start) {
  const value = javascriptIdentifierPattern.exec(source.slice(start))?.[0];
  return value ? { value, end: start + value.length } : null;
}

function skipJavascriptTrivia(source, start) {
  let index = start;
  let sawLineEnding = false;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      if (source[index] === "\n" || source[index] === "\r") {
        sawLineEnding = true;
      }
      index += 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return { index: source.length, sawLineEnding, complete: false };
      if (/[\r\n]/u.test(source.slice(index, end + 2))) sawLineEnding = true;
      index = end + 2;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      if (end < 0) return { index: source.length, sawLineEnding, complete: true };
      sawLineEnding = true;
      index = end + 1;
      continue;
    }
    break;
  }
  return { index, sawLineEnding, complete: true };
}

function javascriptStringEnd(source, start, allowLineEndings = false) {
  const quote = source[start];
  if (!["\"", "'", "`"].includes(quote)) return null;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (!allowLineEndings && /[\r\n]/u.test(source[index])) return null;
    if (source[index] === quote) return index + 1;
  }
  return null;
}

function balancedJavascriptEnd(source, start, open, close) {
  if (source[start] !== open) return null;
  let depth = 1;
  for (let index = start + 1; index < source.length; ) {
    if (["\"", "'", "`"].includes(source[index])) {
      const end = javascriptStringEnd(source, index, source[index] === "`");
      if (end === null) return null;
      index = end;
      continue;
    }
    if (source.startsWith("/*", index) || source.startsWith("//", index)) {
      const trivia = skipJavascriptTrivia(source, index);
      if (!trivia.complete) return null;
      index = trivia.index;
      continue;
    }
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return null;
}

function moduleSpecifierTailIsComplete(source, start) {
  let trivia = skipJavascriptTrivia(source, start);
  if (!trivia.complete) return false;
  if (
    trivia.index >= source.length ||
    trivia.sawLineEnding ||
    source[trivia.index] === ";"
  ) {
    return true;
  }

  const attribute = readJavascriptIdentifier(source, trivia.index);
  if (!attribute || !["assert", "with"].includes(attribute.value)) return false;
  trivia = skipJavascriptTrivia(source, attribute.end);
  const end = balancedJavascriptEnd(source, trivia.index, "{", "}");
  return end !== null && moduleSpecifierTailIsComplete(source, end);
}

function moduleSpecifierEnd(source, start) {
  const trivia = skipJavascriptTrivia(source, start);
  if (!trivia.complete) return null;
  const end = javascriptStringEnd(source, trivia.index);
  return end !== null && moduleSpecifierTailIsComplete(source, end) ? end : null;
}

function namespaceImportEnd(source, start) {
  if (source[start] !== "*") return null;
  let trivia = skipJavascriptTrivia(source, start + 1);
  const asKeyword = readJavascriptIdentifier(source, trivia.index);
  if (!asKeyword || asKeyword.value !== "as") return null;
  trivia = skipJavascriptTrivia(source, asKeyword.end);
  return readJavascriptIdentifier(source, trivia.index)?.end ?? null;
}

function staticImportAt(source, offset) {
  let trivia = skipJavascriptTrivia(source, offset + "import".length);
  if (!trivia.complete) return false;
  if (["\"", "'"].includes(source[trivia.index])) {
    const end = javascriptStringEnd(source, trivia.index);
    return end !== null && moduleSpecifierTailIsComplete(source, end);
  }

  let clauseEnd;
  if (source[trivia.index] === "{") {
    clauseEnd = balancedJavascriptEnd(source, trivia.index, "{", "}");
  } else if (source[trivia.index] === "*") {
    clauseEnd = namespaceImportEnd(source, trivia.index);
  } else {
    const defaultBinding = readJavascriptIdentifier(source, trivia.index);
    if (!defaultBinding) return false;
    trivia = skipJavascriptTrivia(source, defaultBinding.end);
    clauseEnd = defaultBinding.end;
    if (source[trivia.index] === ",") {
      trivia = skipJavascriptTrivia(source, trivia.index + 1);
      clauseEnd =
        source[trivia.index] === "{"
          ? balancedJavascriptEnd(source, trivia.index, "{", "}")
          : namespaceImportEnd(source, trivia.index);
    }
  }
  if (clauseEnd === null || clauseEnd === undefined) return false;

  trivia = skipJavascriptTrivia(source, clauseEnd);
  const fromKeyword = readJavascriptIdentifier(source, trivia.index);
  if (!fromKeyword || fromKeyword.value !== "from") return false;
  return moduleSpecifierEnd(source, fromKeyword.end) !== null;
}

function javascriptStatementTailIsComplete(source, start) {
  const trivia = skipJavascriptTrivia(source, start);
  return (
    trivia.complete &&
    (trivia.index >= source.length ||
      trivia.sawLineEnding ||
      source[trivia.index] === ";")
  );
}

function javascriptPrimaryExpressionEnd(source, start) {
  let trivia = skipJavascriptTrivia(source, start);
  if (!trivia.complete || trivia.index >= source.length) return null;
  let end;
  if (["\"", "'"].includes(source[trivia.index])) {
    end = javascriptStringEnd(source, trivia.index);
  } else if (/[0-9]/u.test(source[trivia.index])) {
    const number = /^(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)[n]?/u.exec(
      source.slice(trivia.index)
    )?.[0];
    end = number ? trivia.index + number.length : null;
  } else if (["(", "[", "{"].includes(source[trivia.index])) {
    const open = source[trivia.index];
    end = balancedJavascriptEnd(
      source,
      trivia.index,
      open,
      open === "(" ? ")" : open === "[" ? "]" : "}"
    );
  } else {
    const unary = readJavascriptIdentifier(source, trivia.index);
    if (unary && ["await", "delete", "typeof", "void"].includes(unary.value)) {
      return javascriptPrimaryExpressionEnd(source, unary.end);
    }
    if (["!", "~", "+", "-"].includes(source[trivia.index])) {
      return javascriptPrimaryExpressionEnd(source, trivia.index + 1);
    }
    end = readJavascriptIdentifier(source, trivia.index)?.end ?? null;
  }
  if (end === null) return null;

  while (true) {
    trivia = skipJavascriptTrivia(source, end);
    if (!trivia.complete || trivia.sawLineEnding) return end;
    if (source.startsWith("?.", trivia.index)) {
      const property = readJavascriptIdentifier(source, trivia.index + 2);
      if (!property) return end;
      end = property.end;
      continue;
    }
    if (source[trivia.index] === ".") {
      const property = readJavascriptIdentifier(source, trivia.index + 1);
      if (!property) return end;
      end = property.end;
      continue;
    }
    if (source[trivia.index] === "(" || source[trivia.index] === "[") {
      const open = source[trivia.index];
      const postfixEnd = balancedJavascriptEnd(
        source,
        trivia.index,
        open,
        open === "(" ? ")" : "]"
      );
      if (postfixEnd === null) return null;
      end = postfixEnd;
      continue;
    }
    return end;
  }
}

function javascriptExportExpressionEnd(source, start) {
  let end = javascriptPrimaryExpressionEnd(source, start);
  if (end === null) return null;
  while (true) {
    const trivia = skipJavascriptTrivia(source, end);
    if (!trivia.complete || trivia.sawLineEnding) return end;
    const operator = /^(?:===|!==|>>>|>>|<<|\*\*|&&|\|\||\?\?|==|!=|<=|>=|=>|[+*/%<>&|^=-])/u.exec(
      source.slice(trivia.index)
    )?.[0];
    if (!operator) return end;
    const right = javascriptPrimaryExpressionEnd(
      source,
      trivia.index + operator.length
    );
    if (right === null) return null;
    end = right;
  }
}

function variableExportAt(source, start, declaration) {
  let cursor = start;
  while (true) {
    let trivia = skipJavascriptTrivia(source, cursor);
    let bindingEnd;
    if (source[trivia.index] === "{" || source[trivia.index] === "[") {
      const open = source[trivia.index];
      bindingEnd = balancedJavascriptEnd(
        source,
        trivia.index,
        open,
        open === "{" ? "}" : "]"
      );
    } else {
      bindingEnd = readJavascriptIdentifier(source, trivia.index)?.end ?? null;
    }
    if (bindingEnd === null) return false;

    trivia = skipJavascriptTrivia(source, bindingEnd);
    if (source[trivia.index] === "=") {
      const valueEnd = javascriptExportExpressionEnd(source, trivia.index + 1);
      if (valueEnd === null) return false;
      cursor = valueEnd;
    } else {
      if (declaration === "const") return false;
      cursor = bindingEnd;
    }

    trivia = skipJavascriptTrivia(source, cursor);
    if (source[trivia.index] !== ",") {
      return javascriptStatementTailIsComplete(source, cursor);
    }
    cursor = trivia.index + 1;
  }
}

function functionExportEnd(source, start, allowAnonymous) {
  let trivia = skipJavascriptTrivia(source, start);
  if (source[trivia.index] === "*") {
    trivia = skipJavascriptTrivia(source, trivia.index + 1);
  }
  const name = readJavascriptIdentifier(source, trivia.index);
  if (name) trivia = skipJavascriptTrivia(source, name.end);
  if (!name && !allowAnonymous) return null;
  const parametersEnd = balancedJavascriptEnd(source, trivia.index, "(", ")");
  if (parametersEnd === null) return null;
  trivia = skipJavascriptTrivia(source, parametersEnd);
  return balancedJavascriptEnd(source, trivia.index, "{", "}");
}

function classExportEnd(source, start, allowAnonymous) {
  let trivia = skipJavascriptTrivia(source, start);
  const name = readJavascriptIdentifier(source, trivia.index);
  if (name) trivia = skipJavascriptTrivia(source, name.end);
  if (!name && !allowAnonymous) return null;

  const extendsKeyword = readJavascriptIdentifier(source, trivia.index);
  if (extendsKeyword?.value === "extends") {
    const superclassEnd = javascriptExportExpressionEnd(
      source,
      extendsKeyword.end
    );
    if (superclassEnd === null) return null;
    trivia = skipJavascriptTrivia(source, superclassEnd);
  }
  if (source[trivia.index] !== "{") return null;
  return balancedJavascriptEnd(source, trivia.index, "{", "}");
}

function staticExportAt(source, offset) {
  let trivia = skipJavascriptTrivia(source, offset + "export".length);
  if (!trivia.complete) return false;

  if (source[trivia.index] === "{") {
    const end = balancedJavascriptEnd(source, trivia.index, "{", "}");
    if (end === null) return false;
    trivia = skipJavascriptTrivia(source, end);
    const fromKeyword = readJavascriptIdentifier(source, trivia.index);
    if (fromKeyword?.value === "from") {
      return moduleSpecifierEnd(source, fromKeyword.end) !== null;
    }
    return javascriptStatementTailIsComplete(source, end);
  }

  if (source[trivia.index] === "*") {
    trivia = skipJavascriptTrivia(source, trivia.index + 1);
    const asKeyword = readJavascriptIdentifier(source, trivia.index);
    if (asKeyword?.value === "as") {
      trivia = skipJavascriptTrivia(source, asKeyword.end);
      const name = readJavascriptIdentifier(source, trivia.index);
      if (!name) return false;
      trivia = skipJavascriptTrivia(source, name.end);
    }
    const fromKeyword = readJavascriptIdentifier(source, trivia.index);
    return (
      fromKeyword?.value === "from" &&
      moduleSpecifierEnd(source, fromKeyword.end) !== null
    );
  }

  const declaration = readJavascriptIdentifier(source, trivia.index);
  if (!declaration) return false;
  trivia = skipJavascriptTrivia(source, declaration.end);
  if (["const", "let", "var"].includes(declaration.value)) {
    return variableExportAt(source, declaration.end, declaration.value);
  }
  if (declaration.value === "function") {
    const end = functionExportEnd(source, declaration.end, false);
    return end !== null && javascriptStatementTailIsComplete(source, end);
  }
  if (declaration.value === "class") {
    const end = classExportEnd(source, declaration.end, false);
    return end !== null && javascriptStatementTailIsComplete(source, end);
  }
  if (declaration.value === "async") {
    const functionKeyword = readJavascriptIdentifier(source, trivia.index);
    if (functionKeyword?.value !== "function") return false;
    const end = functionExportEnd(source, functionKeyword.end, false);
    return end !== null && javascriptStatementTailIsComplete(source, end);
  }
  if (declaration.value !== "default") return false;
  if (trivia.index >= source.length || source[trivia.index] === ";") return false;
  const defaultKind = readJavascriptIdentifier(source, trivia.index);
  if (defaultKind?.value === "function") {
    const end = functionExportEnd(source, defaultKind.end, true);
    return end !== null && javascriptStatementTailIsComplete(source, end);
  }
  if (defaultKind?.value === "class") {
    const end = classExportEnd(source, defaultKind.end, true);
    return end !== null && javascriptStatementTailIsComplete(source, end);
  }
  const expressionEnd = javascriptExportExpressionEnd(source, trivia.index);
  return (
    expressionEnd !== null &&
    javascriptStatementTailIsComplete(source, expressionEnd)
  );
}

function skipJsxWhitespace(source, start) {
  let index = start;
  let lineEndings = 0;
  while (/\s/u.test(source[index] || "")) {
    if (source[index] === "\r") {
      lineEndings += 1;
      if (source[index + 1] === "\n") index += 1;
    } else if (source[index] === "\n") {
      lineEndings += 1;
    }
    if (lineEndings > 1) return null;
    index += 1;
  }
  return { index, lineEndings };
}

function parseJsxTagTail(source, start) {
  let cursor = start;
  let hasExplicitAttributes = false;
  while (cursor < source.length) {
    const whitespace = skipJsxWhitespace(source, cursor);
    if (!whitespace) return null;
    cursor = whitespace.index;
    if (source[cursor] === ">") {
      return { end: cursor, selfClosing: false, hasExplicitAttributes };
    }
    if (source[cursor] === "/") {
      const afterSlash = skipJsxWhitespace(source, cursor + 1);
      if (!afterSlash || source[afterSlash.index] !== ">") return null;
      return {
        end: afterSlash.index,
        selfClosing: true,
        hasExplicitAttributes
      };
    }
    if (source[cursor] === "{") {
      const expressionEnd = balancedJavascriptEnd(source, cursor, "{", "}");
      if (expressionEnd === null) return null;
      hasExplicitAttributes = true;
      cursor = expressionEnd;
      continue;
    }

    const attribute = jsxNamePattern.exec(source.slice(cursor))?.[0];
    if (!attribute) return null;
    cursor += attribute.length;
    const afterName = skipJsxWhitespace(source, cursor);
    if (!afterName) return null;
    cursor = afterName.index;
    if (source[cursor] !== "=") continue;

    hasExplicitAttributes = true;
    const beforeValue = skipJsxWhitespace(source, cursor + 1);
    if (!beforeValue) return null;
    cursor = beforeValue.index;
    if (["\"", "'"].includes(source[cursor])) {
      const valueEnd = javascriptStringEnd(source, cursor);
      if (valueEnd === null) return null;
      cursor = valueEnd;
    } else if (source[cursor] === "{") {
      const valueEnd = balancedJavascriptEnd(source, cursor, "{", "}");
      if (valueEnd === null) return null;
      cursor = valueEnd;
    } else {
      const value = /^[^\s"'=<>`]+/u.exec(source.slice(cursor))?.[0];
      if (!value) return null;
      cursor += value.length;
    }
  }
  return null;
}

function isChainedComparison(source, tagStart, tagEnd) {
  let leftIndex = tagStart - 1;
  while (source[leftIndex] === " " || source[leftIndex] === "\t") leftIndex -= 1;
  let leftStart = leftIndex;
  if (
    leftIndex > 0 &&
    /[\uDC00-\uDFFF]/u.test(source[leftIndex]) &&
    /[\uD800-\uDBFF]/u.test(source[leftIndex - 1])
  ) {
    leftStart -= 1;
  }
  let rightIndex = tagEnd + 1;
  while (source[rightIndex] === " " || source[rightIndex] === "\t") rightIndex += 1;
  if (source[rightIndex] === "=") {
    rightIndex += 1;
    while (source[rightIndex] === " " || source[rightIndex] === "\t") {
      rightIndex += 1;
    }
  }
  if (source[rightIndex] === "+" || source[rightIndex] === "-") {
    rightIndex += 1;
    while (source[rightIndex] === " " || source[rightIndex] === "\t") {
      rightIndex += 1;
    }
  }
  const left = source.slice(leftStart, leftIndex + 1);
  const rightCodePoint = source.codePointAt(rightIndex);
  const right =
    rightCodePoint === undefined ? "" : String.fromCodePoint(rightCodePoint);
  return (
    /^[$_\u200C\u200D\p{ID_Continue})\]]$/u.test(left) &&
    /^[$_\p{ID_Start}\p{N}(\[]$/u.test(right)
  );
}

function sourceLineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function sourceLineAtOffset(lineStarts, offset, bodyStartLine) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return bodyStartLine + low - 1;
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
  lineStarts,
  bodyStartLine,
  offset,
  rule,
  message,
  correction
) {
  problems.push(
    issue(
      file,
      sourceLineAtOffset(lineStarts, offset, bodyStartLine),
      rule,
      message,
      correction
    )
  );
}

function scanExcludedSyntax(ast, body, file, bodyStartLine, problems) {
  const source = maskNonScannableRanges(ast, body);
  const lineStarts = sourceLineStarts(source);

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
        lineStarts,
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
        lineStarts,
        bodyStartLine,
        offset,
        "markdown/directive",
        "Markdown directives are not allowed.",
        "Use ordinary Markdown, or escape the leading colon when it is literal text."
      );
    }
  }

  const esmPattern =
    /(^|\n)[ \t]{0,3}(import|export)(?![$_\u200C\u200D\p{ID_Continue}-])/gu;
  while ((match = esmPattern.exec(source))) {
    const offset = match.index + match[0].lastIndexOf(match[2]);
    const isStaticStatement =
      match[2] === "import"
        ? staticImportAt(source, offset)
        : staticExportAt(source, offset);
    if (!isStaticStatement) continue;
    addExcludedSyntaxIssue(
      problems,
      file,
      lineStarts,
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
        lineStarts,
        bodyStartLine,
        offset,
        "markdown/expression",
        "Executable expression syntax is not allowed.",
        "Remove the expression, escape literal braces, or put a non-executed example in code."
      );
      offset = end - 1;
    }
  }

  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== "<" || isEscaped(source, offset)) continue;
    let whitespace = skipJsxWhitespace(source, offset + 1);
    if (!whitespace) continue;
    let nameStart = whitespace.index;
    let closing = false;
    if (source[nameStart] === "/") {
      closing = true;
      whitespace = skipJsxWhitespace(source, nameStart + 1);
      if (!whitespace) continue;
      nameStart = whitespace.index;
    }
    if (source[nameStart] === ">") {
      addExcludedSyntaxIssue(
        problems,
        file,
        lineStarts,
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
    if (!/[\s/>]/u.test(boundary || "")) continue;
    const tag = parseJsxTagTail(source, nameStart + name.length);
    if (!tag) continue;
    const hasStrongTagSignal =
      closing ||
      tag.selfClosing ||
      tag.hasExplicitAttributes ||
      name.includes(".") ||
      name.includes(":") ||
      ["embed", "iframe", "object", "script", "style"].includes(name);
    if (
      hasStrongTagSignal ||
      !isChainedComparison(source, offset, tag.end)
    ) {
      addExcludedSyntaxIssue(
        problems,
        file,
        lineStarts,
        bodyStartLine,
        offset,
        "markdown/jsx",
        "JSX/Astro component syntax is not allowed.",
        "Remove the component markup or put a non-executed example in code."
      );
      offset = tag.end;
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
