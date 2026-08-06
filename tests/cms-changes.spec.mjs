import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  checkCmsChanges,
  formatChangeIssue,
  isAllowedCmsPath
} from "../scripts/check-cms-changes.mjs";

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function write(root, path, contents = "fixture\n") {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), "cms-changes-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "CMS Fixture");
  git(root, "config", "user.email", "cms-fixture@example.com");
  write(root, "README.md", "code-owned\n");
  write(root, "src/data/site.json", "{}\n");
  write(root, "src/content/faqs/one.md", "---\nquestion: One\n---\nAnswer\n");
  write(root, "src/content/pages/home.md", "---\nroute: /\n---\nHome\n");
  write(root, "public/uploads/images/existing.png", "image\n");
  write(root, "public/uploads/documents/existing.pdf", "pdf\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "switch", "-c", "cms/fixture");
  return root;
}

function commitAll(root, message = "fixture change") {
  git(root, "add", "-A");
  git(root, "commit", "-m", message);
}

function rules(result) {
  return new Set(result.issues.map((issue) => issue.rule));
}

function assertPasses(result) {
  assert.deepEqual(
    result.issues,
    [],
    result.issues.map(formatChangeIssue).join("\n")
  );
}

function assertFailsWith(result, rule) {
  assert.ok(
    rules(result).has(rule),
    `expected ${rule}; received:\n${result.issues.map(formatChangeIssue).join("\n")}`
  );
}

function withRepository(transform, assertion) {
  const root = setupRepository();
  try {
    transform(root);
    assertion(checkCmsChanges({ cwd: root, baseRef: "main", head: "HEAD" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("allows approved additions, modifications, deletions, renames, and copies", () => {
  const fixtures = [
    [
      "addition",
      (root) => {
        write(
          root,
          "src/content/faqs/two.md",
          `---\nquestion: A wholly distinct fixture\n---\n${"new material ".repeat(30)}\n`
        );
        commitAll(root);
      },
      "A"
    ],
    [
      "modification",
      (root) => {
        write(root, "src/data/site.json", "{\"name\":\"Updated\"}\n");
        commitAll(root);
      },
      "M"
    ],
    [
      "deletion",
      (root) => {
        rmSync(join(root, "src/content/faqs/one.md"));
        commitAll(root);
      },
      "D"
    ],
    [
      "rename",
      (root) => {
        git(root, "mv", "src/content/faqs/one.md", "src/content/faqs/renamed.md");
        commitAll(root);
      },
      "R"
    ],
    [
      "copy",
      (root) => {
        copyFileSync(
          join(root, "src/content/faqs/one.md"),
          join(root, "src/content/faqs/copied.md")
        );
        commitAll(root);
      },
      "C"
    ],
    [
      "image",
      (root) => {
        write(root, "public/uploads/images/approved-photo.webp", "distinct webp fixture bytes 0123456789\n");
        commitAll(root);
      },
      "A"
    ],
    [
      "PDF",
      (root) => {
        write(root, "public/uploads/documents/approved-file.pdf", "distinct pdf fixture bytes abcdefghijklmnop\n");
        commitAll(root);
      },
      "A"
    ]
  ];

  for (const [name, transform, status] of fixtures) {
    withRepository(transform, (result) => {
      assertPasses(result);
      assert.ok(
        result.changes.some((change) => change.status === status),
        `${name} should produce ${status}: ${JSON.stringify(result.changes)}`
      );
    });
  }
});

test("rejects disallowed additions, modifications, deletions, renames, and copies", () => {
  const fixtures = [
    ["addition", (root) => write(root, "scripts/unsafe.mjs"), (root) => commitAll(root)],
    ["modification", (root) => write(root, "README.md", "changed\n"), (root) => commitAll(root)],
    ["deletion", (root) => rmSync(join(root, "README.md")), (root) => commitAll(root)],
    [
      "rename",
      (root) => {
        mkdirSync(join(root, "scripts"), { recursive: true });
        git(root, "mv", "src/content/faqs/one.md", "scripts/one.md");
      },
      (root) => commitAll(root)
    ],
    [
      "copy old path",
      (root) => copyFileSync(join(root, "README.md"), join(root, "src/content/faqs/copied.md")),
      (root) => commitAll(root)
    ]
  ];

  for (const [, transform, finish] of fixtures) {
    withRepository(
      (root) => {
        transform(root);
        finish(root);
      },
      (result) => assertFailsWith(result, "cms-changes/path-boundary")
    );
  }
});

test("rejects disallowed extensions and unsafe path edges", () => {
  const paths = [
    "public/uploads/images/vector.svg",
    "public/uploads/images/UPPER.PNG",
    "public/uploads/images/bad..name.png",
    "public/uploads/images/nested/photo.png",
    "public/uploads/images/%2e%2e.png",
    "public/uploads/documents/file.pdf.txt",
    "src/content/faqs/entry.mdx"
  ];

  for (const path of paths) {
    withRepository(
      (root) => {
        write(root, path);
        commitAll(root);
      },
      (result) => assertFailsWith(result, "cms-changes/path-boundary")
    );
  }

  for (const path of [
    "../src/content/faqs/escape.md",
    "/src/content/faqs/absolute.md",
    "src/content/faqs/../escape.md",
    "src\\content\\faqs\\escape.md",
    "src/content/faqs/bad\nname.md"
  ]) {
    assert.equal(isAllowedCmsPath(path), false, path);
  }
});

test("rejects symlinks, submodules, and executable file modes", () => {
  withRepository(
    (root) => {
      symlinkSync(
        join(root, "public/uploads/images/existing.png"),
        join(root, "public/uploads/images/link.png")
      );
      commitAll(root);
    },
    (result) => assertFailsWith(result, "cms-changes/symlink")
  );

  withRepository(
    (root) => {
      const commit = git(root, "rev-parse", "HEAD");
      git(
        root,
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${commit},public/uploads/images/module.png`
      );
      git(root, "commit", "-m", "gitlink fixture");
    },
    (result) => assertFailsWith(result, "cms-changes/submodule")
  );

  withRepository(
    (root) => {
      chmodSync(join(root, "src/content/faqs/one.md"), 0o755);
      commitAll(root);
    },
    (result) => assertFailsWith(result, "cms-changes/file-mode")
  );
});

test("fails closed when exact revisions cannot be established", () => {
  const root = setupRepository();
  try {
    assertFailsWith(
      checkCmsChanges({ cwd: root, baseRef: "missing-main", head: "HEAD" }),
      "cms-changes/revision"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
