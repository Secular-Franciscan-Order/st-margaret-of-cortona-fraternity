import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const CONTENT_ROOTS = [
  "src/content/pages/",
  "src/content/faqs/",
  "src/content/resources/"
];

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpg|jpeg|png)$/;
const SAFE_DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/;

function problem(rule, message, correction, path) {
  return { rule, message, correction, path };
}

export function formatChangeIssue(issue) {
  const location = issue.path ? `${issue.path}: ` : "";
  return `[${issue.rule}] ${location}${issue.message} Correction: ${issue.correction}`;
}

function runGit(cwd, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd,
    encoding,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function safeSegments(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("..") &&
      SAFE_COMPONENT.test(segment)
  );
}

export function isAllowedCmsPath(path) {
  if (!safeSegments(path)) return false;
  if (path === "src/data/site.json") return true;

  for (const root of CONTENT_ROOTS) {
    if (path.startsWith(root)) {
      const relativePath = path.slice(root.length);
      return relativePath.endsWith(".md") && safeSegments(relativePath);
    }
  }

  if (path.startsWith("public/uploads/images/")) {
    const filename = path.slice("public/uploads/images/".length);
    return !filename.includes("/") && SAFE_IMAGE.test(filename);
  }

  if (path.startsWith("public/uploads/documents/")) {
    const filename = path.slice("public/uploads/documents/".length);
    return !filename.includes("/") && SAFE_DOCUMENT.test(filename);
  }

  return false;
}

export function parseNameStatus(buffer) {
  const tokens = buffer.toString("utf8").split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const changes = [];

  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (/^[RC]\d{1,3}$/.test(status)) {
      if (index + 1 >= tokens.length) {
        throw new Error(`Incomplete ${status} name-status record.`);
      }
      changes.push({
        status: status[0],
        score: Number(status.slice(1)),
        oldPath: tokens[index++],
        newPath: tokens[index++]
      });
    } else if (/^[AMD]$/.test(status)) {
      if (index >= tokens.length) {
        throw new Error(`Incomplete ${status} name-status record.`);
      }
      const path = tokens[index++];
      changes.push({ status, oldPath: status === "A" ? undefined : path, newPath: status === "D" ? undefined : path });
    } else {
      throw new Error(`Unsupported git name-status record ${JSON.stringify(status)}.`);
    }
  }

  return changes;
}

function treeEntry(cwd, revision, path) {
  const output = runGit(cwd, ["ls-tree", "-z", revision, "--", path], "buffer");
  if (output.length === 0) return null;
  const record = output.toString("utf8").replace(/\0$/, "");
  const tab = record.indexOf("\t");
  const metadata = record.slice(0, tab).split(" ");
  return { mode: metadata[0], type: metadata[1], object: metadata[2] };
}

function inspectPath(cwd, revision, path, side, issues) {
  if (!isAllowedCmsPath(path)) {
    issues.push(
      problem(
        "cms-changes/path-boundary",
        `${side} path is outside the approved CMS ownership boundary.`,
        "Keep CMS changes to site.json, approved Markdown roots, or approved image/PDF files; make every other change on a non-CMS reviewed branch.",
        path
      )
    );
  }

  const entry = treeEntry(cwd, revision, path);
  if (!entry) {
    issues.push(
      problem(
        "cms-changes/object-missing",
        `${side} object cannot be resolved at ${revision}.`,
        "Fetch sufficient history and retry with the exact base and head commits.",
        path
      )
    );
    return;
  }

  if (entry.mode === "120000") {
    issues.push(
      problem(
        "cms-changes/symlink",
        `${side} object is a symlink, which CMS branches may not change.`,
        "Replace it with a regular approved file on a non-CMS reviewed branch.",
        path
      )
    );
  } else if (entry.mode === "160000" || entry.type === "commit") {
    issues.push(
      problem(
        "cms-changes/submodule",
        `${side} object is a submodule, which CMS branches may not change.`,
        "Remove the submodule change and use a regular approved file.",
        path
      )
    );
  } else if (entry.mode !== "100644" || entry.type !== "blob") {
    issues.push(
      problem(
        "cms-changes/file-mode",
        `${side} object must be a non-executable regular file, not mode ${entry.mode} type ${entry.type}.`,
        "Use a regular 100644 file or move the change to a non-CMS reviewed branch.",
        path
      )
    );
  }
}

function gitFailure(error) {
  const stderr = error?.stderr?.toString?.().trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}

export function checkCmsChanges({
  cwd = process.cwd(),
  baseRef = "origin/main",
  head = "HEAD"
} = {}) {
  const repository = resolve(cwd);
  const issues = [];
  let baseSha;
  let headSha;
  let mergeBase;
  let changes = [];

  try {
    baseSha = runGit(repository, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${baseRef}^{commit}`
    ]).trim();
    headSha = runGit(repository, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${head}^{commit}`
    ]).trim();
  } catch (error) {
    issues.push(
      problem(
        "cms-changes/revision",
        `The exact base or head commit cannot be resolved: ${gitFailure(error)}`,
        "Fetch current main and the exact head commit, then pass valid --base-ref and --head values."
      )
    );
    return { issues, baseSha, headSha, mergeBase, changes };
  }

  try {
    mergeBase = runGit(repository, ["merge-base", baseSha, headSha]).trim();
    if (!/^[0-9a-f]{40,64}$/.test(mergeBase)) {
      throw new Error("git merge-base did not return a full object ID");
    }
  } catch (error) {
    issues.push(
      problem(
        "cms-changes/merge-base",
        `A merge base with current main cannot be established: ${gitFailure(error)}`,
        "Fetch sufficient main and head history and retry; do not create or merge the CMS PR."
      )
    );
    return { issues, baseSha, headSha, mergeBase, changes };
  }

  try {
    const output = runGit(
      repository,
      [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--find-copies",
        "--find-copies-harder",
        mergeBase,
        headSha,
        "--"
      ],
      "buffer"
    );
    changes = parseNameStatus(output);
  } catch (error) {
    issues.push(
      problem(
        "cms-changes/diff",
        `The exact CMS diff cannot be established: ${gitFailure(error)}`,
        "Fetch sufficient history and retry against current main and the exact head commit."
      )
    );
    return { issues, baseSha, headSha, mergeBase, changes };
  }

  for (const change of changes) {
    if (!["A", "M", "D", "R", "C"].includes(change.status)) {
      issues.push(
        problem(
          "cms-changes/status",
          `Git status ${change.status} is not an explicitly supported CMS change.`,
          "Use only an addition, modification, deletion, rename, or copy of approved regular files."
        )
      );
      continue;
    }

    if (change.oldPath) {
      inspectPath(repository, mergeBase, change.oldPath, "old", issues);
    }
    if (change.newPath) {
      inspectPath(repository, headSha, change.newPath, "new", issues);
    }
  }

  return { issues, baseSha, headSha, mergeBase, changes };
}

function cliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--base-ref" || argument === "--head") {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--base-ref") options.baseRef = value;
      else options.head = value;
    } else {
      throw new Error(`Unknown argument ${argument}.`);
    }
  }
  return options;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const result = checkCmsChanges(cliOptions(process.argv.slice(2)));
    if (result.issues.length) {
      for (const issue of result.issues) console.error(formatChangeIssue(issue));
      console.error(`CMS changed-path guard failed with ${result.issues.length} issue(s).`);
      process.exitCode = 1;
    } else {
      console.log(
        `CMS changed-path guard passed: ${result.changes.length} change(s) from ${result.mergeBase} to exact head ${result.headSha}.`
      );
    }
  } catch (error) {
    console.error(`[cms-changes/usage] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
