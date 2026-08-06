import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStrictYaml } from "../scripts/check-cms-content.mjs";
import { parseCmsReviewPayload } from "../scripts/parse-cms-review-payload.mjs";

const workflowSource = readFileSync(
  new URL("../.github/workflows/cms-review.yml", import.meta.url),
  "utf8"
);
const ciSource = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8"
);

const trusted = {
  expectedRepository:
    "Secular-Franciscan-Order/st-margaret-of-cortona-fraternity",
  trustedRef: "refs/heads/main",
  trustedSha: "a".repeat(40)
};

function payload(overrides = {}) {
  const value = {
    source: "pages-cms",
    action: { name: "open-review-pr", label: "Open review PR" },
    repository: {
      owner: "Secular-Franciscan-Order",
      repo: "st-margaret-of-cortona-fraternity",
      ref: "cms/update-faq",
      workflowRef: "main",
      sha: "b".repeat(40)
    }
  };
  return JSON.stringify({ ...value, ...overrides });
}

test("accepts one exact same-repository Pages CMS review request", () => {
  assert.deepEqual(parseCmsReviewPayload(payload(), trusted), {
    branch: "cms/update-faq",
    sha: "b".repeat(40)
  });
});

test("locks the review workflow to trusted main workflow_dispatch data", () => {
  const parsed = parseStrictYaml(workflowSource, { file: "cms-review.yml" });
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(Object.keys(parsed.value.on), ["workflow_dispatch"]);
  assert.deepEqual(parsed.value.on.workflow_dispatch.inputs, {
    payload: {
      description: "Pages CMS payload as JSON",
      required: true,
      type: "string"
    }
  });
  assert.deepEqual(parsed.value.permissions, {
    contents: "read",
    "pull-requests": "write"
  });

  assert.equal((workflowSource.match(/uses: actions\/checkout@v6/g) || []).length, 1);
  assert.match(workflowSource, /persist-credentials: false/);
  assert.match(workflowSource, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflowSource, /CMS_ACTION_PAYLOAD: \$\{\{ inputs\.payload \}\}/);
  assert.match(workflowSource, /TRUSTED_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflowSource, /node scripts\/parse-cms-review-payload\.mjs/);
  assert.match(workflowSource, /refs\/remotes\/origin\/cms-review-head/);
  assert.ok(
    workflowSource.indexOf("node scripts/check-cms-changes.mjs") <
      workflowSource.indexOf("gh pr create")
  );

  const runScripts = parsed.value.jobs["draft-pr"].steps
    .map((step) => step.run)
    .filter(Boolean);
  assert.ok(runScripts.every((script) => !script.includes("${{ inputs.payload }}")));
  for (const script of runScripts) {
    const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test("keeps ordinary CI read-only and verifies deploy output before Playwright", () => {
  const parsed = parseStrictYaml(ciSource, { file: "ci.yml" });
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.value.permissions, { contents: "read" });
  assert.deepEqual(parsed.value.on.push.branches, ["main", "cms/**"]);
  assert.ok(ciSource.includes("pull_request:"));
  assert.ok(ciSource.includes("pnpm test:cms"));
  assert.ok(ciSource.includes("pnpm test:built-site"));
  assert.ok(
    ciSource.indexOf("pnpm verify:deploy") < ciSource.indexOf("pnpm test:e2e")
  );
});

test("rejects malformed, untrusted, cross-repository, and unsafe payloads", () => {
  const fixtures = [
    ["not json", trusted],
    ["[]", trusted],
    [payload({ source: "other" }), trusted],
    [payload({ action: { name: "other" } }), trusted],
    [
      payload({
        repository: {
          owner: "attacker",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "cms/update-faq",
          workflowRef: "main",
          sha: "b".repeat(40)
        }
      }),
      trusted
    ],
    [
      payload({
        repository: {
          owner: "Secular-Franciscan-Order",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "feature/not-cms",
          workflowRef: "main",
          sha: "b".repeat(40)
        }
      }),
      trusted
    ],
    [
      payload({
        repository: {
          owner: "Secular-Franciscan-Order",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "cms/safe;echo-unsafe",
          workflowRef: "main",
          sha: "b".repeat(40)
        }
      }),
      trusted
    ],
    [
      payload({
        repository: {
          owner: "Secular-Franciscan-Order",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "cms/update-faq",
          workflowRef: "current",
          sha: "b".repeat(40)
        }
      }),
      trusted
    ],
    [
      payload({
        repository: {
          owner: "Secular-Franciscan-Order",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "cms/update-faq",
          workflowRef: "main",
          sha: "short"
        }
      }),
      trusted
    ],
    [payload(), { ...trusted, trustedRef: "refs/heads/cms/update-faq" }],
    [payload(), { ...trusted, trustedSha: "short" }]
  ];

  for (const [source, context] of fixtures) {
    assert.throws(() => parseCmsReviewPayload(source, context));
  }
});

test("rejects oversized action payloads before JSON parsing", () => {
  assert.throws(() =>
    parseCmsReviewPayload(`{"padding":"${"x".repeat(70 * 1024)}"}`, trusted)
  );
});
