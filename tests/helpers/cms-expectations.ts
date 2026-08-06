import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "yaml";

export interface MarkdownBodyExpectation {
  renderable: boolean;
  renderedBlockCount: number;
  blocks: MarkdownBlockExpectation[];
}

export interface MarkdownBlockExpectation {
  tagName:
    | "p"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "h6"
    | "blockquote"
    | "ol"
    | "ul"
    | "pre"
    | "hr";
  authoredTextSegments: string[];
  authoredLinkHrefs: string[];
  authoredImages: MarkdownImageExpectation[];
}

export interface MarkdownImageExpectation {
  src: string;
  alt: string;
}

export interface SiteExpectation {
  name: string;
  description: string;
  homeHero: {
    image: string;
    imageAlt: string;
  };
  contact: {
    name: string;
    email: string;
    phone: string;
  };
}

export interface PageExpectation {
  source: string;
  title: string;
  route: string;
  navLabel: string;
  navOrder: number;
  description: string;
  body: MarkdownBodyExpectation;
}

export interface FaqExpectation {
  source: string;
  question: string;
  order: number;
  published: boolean;
  body: MarkdownBodyExpectation;
}

export interface ResourceExpectation {
  source: string;
  title: string;
  sortDate: string;
  linkLabel: string;
  uploadedFile: string;
  externalUrl: string;
  published: boolean;
  href: string;
  renderedLinkLabel: string;
  body: MarkdownBodyExpectation;
}

export interface CmsExpectations {
  site: SiteExpectation;
  pages: PageExpectation[];
  publishedFaqs: FaqExpectation[];
  publishedResources: ResourceExpectation[];
}

type UnknownRecord = Record<string, unknown>;
type RootMarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];
type TraversableMarkdownNode = {
  type: string;
  children?: TraversableMarkdownNode[];
  identifier?: string;
  url?: string;
  value?: string;
  alt?: string | null;
};

const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function normalizeRenderedTypography(value: string) {
  return value
    .replace(/\.(?:\s+\.){2,}/g, "...")
    .replace(/\.{3,}/g, "...")
    .replace(/…/g, "...")
    .replace(/''|``/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "--")
    .replace(/\s+/g, " ")
    .trim();
}

function requireRecord(value: unknown, context: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object.`);
  }

  return value as UnknownRecord;
}

function requireString(
  record: UnknownRecord,
  property: string,
  context: string
): string {
  const value = record[property];

  if (typeof value !== "string") {
    throw new TypeError(`${context}.${property} must be a string.`);
  }

  return value;
}

function optionalString(
  record: UnknownRecord,
  property: string,
  context: string,
  fallback = ""
): string {
  const value = record[property];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${context}.${property} must be a string when present.`);
  }

  return value;
}

function requireNumber(
  record: UnknownRecord,
  property: string,
  context: string
): number {
  const value = record[property];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context}.${property} must be a finite number.`);
  }

  return value;
}

function requireIsoDate(
  record: UnknownRecord,
  property: string,
  context: string
): string {
  const value = requireString(record, property, context);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${context}.${property} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`${context}.${property} must be a valid date.`);
  }

  return value;
}

function booleanWithDefault(
  record: UnknownRecord,
  property: string,
  context: string,
  fallback: boolean
): boolean {
  const value = record[property];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`${context}.${property} must be a boolean when present.`);
  }

  return value;
}

function collectDefinitions(
  tree: TraversableMarkdownNode,
  source: string
): Map<string, string> {
  const definitions = new Map<string, string>();

  function visit(node: TraversableMarkdownNode) {
    if (node.type === "definition") {
      if (typeof node.identifier !== "string" || typeof node.url !== "string") {
        throw new Error(`Invalid Markdown definition node in ${source}.`);
      }

      const identifier = node.identifier.toLowerCase();
      if (!definitions.has(identifier)) {
        definitions.set(identifier, node.url);
      }
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(tree);
  return definitions;
}

function collectAuthoredLinks(
  block: TraversableMarkdownNode,
  definitions: ReadonlyMap<string, string>,
  source: string
): string[] {
  const hrefs: string[] = [];

  function visit(node: TraversableMarkdownNode) {
    if (node.type === "link") {
      if (typeof node.url !== "string") {
        throw new Error(`Invalid Markdown link node in ${source}.`);
      }
      hrefs.push(node.url);
    } else if (node.type === "linkReference") {
      if (typeof node.identifier !== "string") {
        throw new Error(`Invalid Markdown link reference node in ${source}.`);
      }

      const href = definitions.get(node.identifier.toLowerCase());
      if (href === undefined) {
        throw new Error(
          `Unresolved Markdown link reference ${JSON.stringify(node.identifier)} in ${source}.`
        );
      }
      hrefs.push(href);
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(block);
  return hrefs;
}

function collectAuthoredTextSegments(
  block: TraversableMarkdownNode,
  source: string
): string[] {
  const segments: string[] = [];

  function visit(node: TraversableMarkdownNode) {
    if (
      node.type === "text" ||
      node.type === "inlineCode" ||
      node.type === "code"
    ) {
      if (typeof node.value !== "string") {
        throw new Error(`Invalid Markdown ${node.type} node in ${source}.`);
      }

      if (node.value.trim().length > 0) {
        segments.push(node.value);
      }
      return;
    }

    if (node.type === "image" || node.type === "imageReference") {
      return;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(block);
  return segments;
}

function collectAuthoredImages(
  block: TraversableMarkdownNode,
  definitions: ReadonlyMap<string, string>,
  source: string
): MarkdownImageExpectation[] {
  const images: MarkdownImageExpectation[] = [];

  function visit(node: TraversableMarkdownNode) {
    if (node.type === "image" || node.type === "imageReference") {
      if (typeof node.alt !== "string") {
        throw new Error(`Invalid Markdown ${node.type} alt text in ${source}.`);
      }

      let src: string | undefined;

      if (node.type === "image") {
        src = node.url;
      } else if (typeof node.identifier === "string") {
        src = definitions.get(node.identifier.toLowerCase());
      }

      if (src === undefined) {
        throw new Error(`Unresolved Markdown image in ${source}.`);
      }

      images.push({ src, alt: node.alt });
      return;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(block);
  return images;
}

function renderedTagName(
  node: RootMarkdownNode,
  source: string
): MarkdownBlockExpectation["tagName"] | null {
  switch (node.type) {
    case "definition":
      return null;
    case "paragraph":
      return "p";
    case "heading":
      return `h${node.depth}`;
    case "blockquote":
      return "blockquote";
    case "list":
      return node.ordered ? "ol" : "ul";
    case "code":
      return "pre";
    case "thematicBreak":
      return "hr";
    default:
      throw new Error(
        `Unsupported top-level Markdown node type ${JSON.stringify(node.type)} in ${source}.`
      );
  }
}

function loadMarkdown(path: string): {
  data: UnknownRecord;
  body: MarkdownBodyExpectation;
} {
  const source = readFileSync(path, "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!frontmatter) {
    throw new Error(`${path} must begin with a YAML frontmatter block.`);
  }

  const tree = fromMarkdown(source.slice(frontmatter[0].length));
  const definitions = collectDefinitions(tree, path);
  const blocks = tree.children.flatMap((node) => {
    const tagName = renderedTagName(node, path);

    return tagName
      ? [
          {
            tagName,
            authoredTextSegments: collectAuthoredTextSegments(node, path),
            authoredLinkHrefs: collectAuthoredLinks(node, definitions, path),
            authoredImages: collectAuthoredImages(node, definitions, path)
          }
        ]
      : [];
  });

  return {
    data: requireRecord(parse(frontmatter[1]), path),
    body: {
      renderable: blocks.length > 0,
      renderedBlockCount: blocks.length,
      blocks
    }
  };
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return markdownFiles(path);
      }

      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    });
}

function collectionFiles(root: string, collection: string): string[] {
  return markdownFiles(join(root, "src", "content", collection));
}

function loadSite(root: string): SiteExpectation {
  const path = join(root, "src", "data", "site.json");
  const data = requireRecord(JSON.parse(readFileSync(path, "utf8")), path);
  const homeHero = requireRecord(data.homeHero, `${path}.homeHero`);
  const contact = requireRecord(data.contact, `${path}.contact`);

  return {
    name: requireString(data, "name", path),
    description: requireString(data, "description", path),
    homeHero: {
      image: optionalString(homeHero, "image", `${path}.homeHero`),
      imageAlt: optionalString(homeHero, "imageAlt", `${path}.homeHero`)
    },
    contact: {
      name: requireString(contact, "name", `${path}.contact`),
      email: requireString(contact, "email", `${path}.contact`),
      phone: requireString(contact, "phone", `${path}.contact`)
    }
  };
}

function loadPages(root: string): PageExpectation[] {
  return collectionFiles(root, "pages")
    .map((source) => {
      const { data, body } = loadMarkdown(source);

      return {
        source,
        title: requireString(data, "title", source),
        route: requireString(data, "route", source),
        navLabel: requireString(data, "navLabel", source),
        navOrder: requireNumber(data, "navOrder", source),
        description: optionalString(data, "description", source),
        body
      };
    })
    .sort((a, b) => a.navOrder - b.navOrder);
}

function loadFaqs(root: string): FaqExpectation[] {
  return collectionFiles(root, "faqs")
    .map((source) => {
      const { data, body } = loadMarkdown(source);

      return {
        source,
        question: requireString(data, "question", source),
        order: requireNumber(data, "order", source),
        published: booleanWithDefault(data, "published", source, true),
        body
      };
    })
    .filter((faq) => faq.published)
    .sort((a, b) => a.order - b.order);
}

function loadResources(root: string): ResourceExpectation[] {
  return collectionFiles(root, "resources")
    .map((source) => {
      const { data, body } = loadMarkdown(source);
      const title = requireString(data, "title", source);
      const linkLabel = optionalString(data, "linkLabel", source);
      const uploadedFile = optionalString(data, "uploadedFile", source);
      const externalUrl = optionalString(data, "externalUrl", source);

      return {
        source,
        title,
        sortDate: requireIsoDate(data, "sortDate", source),
        linkLabel,
        uploadedFile,
        externalUrl,
        published: booleanWithDefault(data, "published", source, true),
        href: uploadedFile || externalUrl,
        renderedLinkLabel: linkLabel || `View ${title}`,
        body
      };
    })
    .filter((resource) => resource.published)
    .sort(
      (a, b) =>
        b.sortDate.localeCompare(a.sortDate) || a.title.localeCompare(b.title)
    );
}

export function loadCmsExpectations(
  repositoryRoot = defaultRepositoryRoot
): CmsExpectations {
  return {
    site: loadSite(repositoryRoot),
    pages: loadPages(repositoryRoot),
    publishedFaqs: loadFaqs(repositoryRoot),
    publishedResources: loadResources(repositoryRoot)
  };
}

export function requirePageExpectation(
  expectations: CmsExpectations,
  route: string
): PageExpectation {
  const page = expectations.pages.find((entry) => entry.route === route);

  if (!page) {
    throw new Error(`Missing page expectation for fixed route: ${route}`);
  }

  return page;
}

export function expectedDocumentTitle(
  title: string,
  siteName: string
): string {
  return title === siteName ? title : `${title} | ${siteName}`;
}
