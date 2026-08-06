import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
      sha: trusted.trustedSha
    }
  };
  return JSON.stringify({ ...value, ...overrides });
}

test("accepts one exact same-repository Pages CMS review request", () => {
  assert.deepEqual(parseCmsReviewPayload(payload(), trusted), {
    branch: "cms/update-faq"
  });
});

test("writes only the validated CMS branch to workflow output", () => {
  const root = mkdtempSync(join(tmpdir(), "cms-review-output-"));
  const output = join(root, "output");
  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/parse-cms-review-payload.mjs", import.meta.url)
        )
      ],
      {
        encoding: "utf8",
        env: {
          CMS_ACTION_PAYLOAD: payload(),
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: trusted.expectedRepository,
          TRUSTED_REF: trusted.trustedRef,
          TRUSTED_SHA: trusted.trustedSha
        }
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, "utf8"), "branch=cms/update-faq\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  assert.doesNotMatch(workflowSource, /steps\.request\.outputs\.sha/);
  assert.equal(
    (workflowSource.match(/steps\.cms_head\.outputs\.sha/g) || []).length,
    2
  );

  const steps = parsed.value.jobs["draft-pr"].steps;
  const headStep = steps.find((step) => step.id === "cms_head");
  assert.ok(headStep);
  assert.equal(headStep.env.CMS_BRANCH, "${{ steps.request.outputs.branch }}");
  assert.equal(headStep.env.TRUSTED_SHA, "${{ github.sha }}");
  assert.match(
    headStep.run,
    /git rev-parse refs\/remotes\/origin\/main\)" = "\$TRUSTED_SHA"/
  );
  assert.match(headStep.run, /test "\$\{#cms_head_sha\}" -eq 40/);
  assert.match(headStep.run, /\*\[!0-9a-f\]\*/);
  assert.match(
    headStep.run,
    /printf 'sha=%s\\n' "\$cms_head_sha" >> "\$GITHUB_OUTPUT"/
  );
  assert.equal(
    (workflowSource.match(/^[ ]+verify_remote_head$/gm) || []).length,
    3
  );
  assert.ok(
    workflowSource.indexOf("node scripts/check-cms-changes.mjs") <
      workflowSource.indexOf("gh pr create")
  );

  const runScripts = steps
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
          sha: trusted.trustedSha
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
          sha: trusted.trustedSha
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
          sha: trusted.trustedSha
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
          sha: trusted.trustedSha
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
    [
      payload({
        repository: {
          owner: "Secular-Franciscan-Order",
          repo: "st-margaret-of-cortona-fraternity",
          ref: "cms/update-faq",
          workflowRef: "main",
          sha: "b".repeat(40)
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
