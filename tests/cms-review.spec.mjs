import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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
const cmsHeadSha = "b".repeat(40);

// Mirrors the initial action payload assembled by tagged Pages CMS 2.1.8.
const completePagesCmsPayload = {
  source: "pages-cms",
  action: {
    name: "open-review-pr",
    label: "Open review PR",
    cancelable: true
  },
  repository: {
    owner: "Secular-Franciscan-Order",
    repo: "st-margaret-of-cortona-fraternity",
    ref: "cms/update-faq",
    workflowRef: "main",
    sha: trusted.trustedSha
  },
  triggeredAt: "2026-08-06T05:00:00.000Z",
  triggeredBy: {
    userId: "pages-cms-user-id",
    name: "Approved Editor",
    email: "editor@example.com",
    githubUsername: "approved-editor",
    image: "https://example.com/editor.png"
  },
  context: {
    type: "repo",
    name: null,
    path: null,
    data: {}
  },
  inputs: {}
};

const parsedWorkflow = parseStrictYaml(workflowSource, {
  file: "cms-review.yml"
});
const workflowSteps =
  parsedWorkflow.value?.jobs?.["draft-pr"]?.steps || [];
const reviewStep = workflowSteps.find(
  (step) => step.name === "Open one idempotent draft PR"
);
const approvedPrBody = reviewStep?.env?.CMS_PR_BODY;

function payload(overrides = {}) {
  return JSON.stringify({ ...completePagesCmsPayload, ...overrides });
}

function prFixture({
  number = 17,
  repository = trusted.expectedRepository,
  branch = completePagesCmsPayload.repository.ref,
  headSha = cmsHeadSha,
  baseSha = trusted.trustedSha,
  state = "open",
  draft = true,
  body = approvedPrBody
} = {}) {
  return {
    number,
    state,
    draft,
    body,
    head: {
      ref: branch,
      sha: headSha,
      repo: { full_name: repository }
    },
    base: { ref: "main", sha: baseSha }
  };
}

function runReviewHarness({
  prs = [],
  mainSequence = [trusted.trustedSha],
  cmsSequence = [cmsHeadSha]
} = {}) {
  assert.ok(reviewStep?.run);
  assert.equal(typeof approvedPrBody, "string");

  const root = mkdtempSync(join(tmpdir(), "cms-review-harness-"));
  const bin = join(root, "bin");
  const statePath = join(root, "state.json");
  const fakeToolSource = `#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const { basename } = require("node:path");

const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
const statePath = process.env.HARNESS_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
state.calls.push({ tool, args });

function save() {
  writeFileSync(statePath, JSON.stringify(state), "utf8");
}

function fail(message) {
  save();
  console.error(message);
  process.exit(2);
}

function formFields(values) {
  const fields = {};
  for (let index = 0; index < values.length - 1; index += 1) {
    if (values[index] !== "-f" && values[index] !== "-F") continue;
    const field = values[index + 1];
    const separator = field.indexOf("=");
    if (separator >= 0) fields[field.slice(0, separator)] = field.slice(separator + 1);
  }
  return fields;
}

function option(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

if (tool === "git") {
  if (args[0] === "fetch") {
    save();
    process.exit(0);
  }
  if (args[0] === "rev-parse") {
    const ref = args[args.length - 1];
    const isMain = ref === "refs/remotes/origin/main";
    const isCms = ref === "refs/remotes/origin/cms-review-head";
    if (!isMain && !isCms) fail("Unexpected git rev-parse ref: " + ref);
    const sequenceKey = isMain ? "mainSequence" : "cmsSequence";
    const readsKey = isMain ? "mainReads" : "cmsReads";
    const reads = state[readsKey] || 0;
    const sequence = state[sequenceKey];
    const sha = sequence[Math.min(reads, sequence.length - 1)];
    state[readsKey] = reads + 1;
    save();
    process.stdout.write(sha + "\\n");
    process.exit(0);
  }
  fail("Unexpected git invocation: " + args.join(" "));
}

if (tool === "gh" && args[0] === "api") {
  const method = option(args, "--method");
  const endpoint = args.find((value) => value.startsWith("repos/"));
  const fields = formFields(args);
  if (method === "GET" && endpoint === "repos/" + process.env.GH_REPO + "/pulls") {
    save();
    process.stdout.write(JSON.stringify(state.prs));
    process.exit(0);
  }
  const updatePrefix = "repos/" + process.env.GH_REPO + "/pulls/";
  if (method === "PATCH" && endpoint && endpoint.startsWith(updatePrefix)) {
    const number = Number(endpoint.slice(updatePrefix.length));
    const pr = state.prs.find((candidate) => candidate.number === number);
    if (!pr) fail("Attempted to update an unknown PR");
    pr.body = fields.body;
    save();
    process.stdout.write(JSON.stringify(pr));
    process.exit(0);
  }
  fail("Unexpected gh api invocation: " + args.join(" "));
}

if (tool === "gh" && args[0] === "pr" && args[1] === "create") {
  const created = {
    number: state.nextNumber,
    state: "open",
    draft: true,
    body: option(args, "--body"),
    head: {
      ref: process.env.CMS_BRANCH,
      sha: process.env.CMS_HEAD_SHA,
      repo: { full_name: process.env.GH_REPO }
    },
    base: { ref: option(args, "--base"), sha: process.env.TRUSTED_SHA }
  };
  state.nextNumber += 1;
  state.prs.push(created);
  save();
  process.stdout.write("https://example.invalid/pull/" + created.number + "\\n");
  process.exit(0);
}

fail("Unexpected tool invocation: " + tool + " " + args.join(" "));
`;

  try {
    writeFileSync(
      statePath,
      JSON.stringify({
        prs: JSON.parse(JSON.stringify(prs)),
        mainSequence,
        cmsSequence,
        mainReads: 0,
        cmsReads: 0,
        nextNumber: 100,
        calls: []
      }),
      "utf8"
    );
    mkdirSync(bin);
    for (const tool of ["git", "gh"]) {
      writeFileSync(join(bin, tool), fakeToolSource, "utf8");
      chmodSync(join(bin, tool), 0o755);
    }

    const result = spawnSync("bash", ["-c", reviewStep.run], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: `${bin}:${process.env.PATH || ""}`,
        HARNESS_STATE: statePath,
        GH_TOKEN: "synthetic-test-token",
        GH_REPO: trusted.expectedRepository,
        GH_REPO_OWNER: completePagesCmsPayload.repository.owner,
        CMS_BRANCH: completePagesCmsPayload.repository.ref,
        CMS_HEAD_SHA: cmsHeadSha,
        TRUSTED_SHA: trusted.trustedSha,
        CMS_PR_BODY: approvedPrBody
      }
    });
    return {
      result,
      state: JSON.parse(readFileSync(statePath, "utf8"))
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function callsFor(state, tool, ...prefix) {
  return state.calls.filter(
    (call) =>
      call.tool === tool &&
      prefix.every((value, index) => call.args[index] === value)
  );
}

test("reduces the complete tagged Pages CMS 2.1.8 payload to its branch", () => {
  assert.deepEqual(Object.keys(completePagesCmsPayload), [
    "source",
    "action",
    "repository",
    "triggeredAt",
    "triggeredBy",
    "context",
    "inputs"
  ]);
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
  assert.deepEqual(parsedWorkflow.issues, []);
  assert.deepEqual(Object.keys(parsedWorkflow.value.on), ["workflow_dispatch"]);
  assert.deepEqual(parsedWorkflow.value.on.workflow_dispatch.inputs, {
    payload: {
      description: "Pages CMS payload as JSON",
      required: true,
      type: "string"
    }
  });
  assert.deepEqual(parsedWorkflow.value.permissions, {
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

  const steps = workflowSteps;
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
  assert.ok(reviewStep);
  assert.equal(reviewStep.env.TRUSTED_SHA, "${{ github.sha }}");
  assert.match(reviewStep.run, /gh api --method GET "repos\/\$GH_REPO\/pulls"/);
  assert.match(reviewStep.run, /head="\$GH_REPO_OWNER:\$CMS_BRANCH"/);
  assert.match(reviewStep.run, /\.base\.sha == \$base/);
  assert.match(reviewStep.run, /gh api --method PATCH/);
  assert.match(approvedPrBody, /This change is not published/);
  assert.match(approvedPrBody, /Administrator warning/);
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

test("ignores a foreign-only same-name PR and creates an exact candidate", () => {
  const foreign = prFixture({
    number: 91,
    repository: "fork-owner/st-margaret-of-cortona-fraternity",
    body: "Foreign PR body"
  });
  const { result, state } = runReviewHarness({ prs: [foreign] });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(callsFor(state, "gh", "pr", "create").length, 1);
  assert.equal(state.prs.length, 2);
  assert.equal(state.prs.find((pr) => pr.number === 91).body, "Foreign PR body");
  const created = state.prs.find(
    (pr) => pr.head.repo.full_name === trusted.expectedRepository
  );
  assert.equal(created.base.sha, trusted.trustedSha);
  assert.equal(created.body, approvedPrBody);

  const getCall = callsFor(state, "gh", "api", "--method", "GET")[0];
  assert.ok(getCall.args.includes("state=open"));
  assert.ok(getCall.args.includes("base=main"));
  assert.ok(
    getCall.args.includes(
      `head=${completePagesCmsPayload.repository.owner}:${completePagesCmsPayload.repository.ref}`
    )
  );

  const createIndex = state.calls.findIndex(
    (call) => call.tool === "gh" && call.args[0] === "pr"
  );
  assert.equal(state.calls[createIndex - 1].tool, "git");
  assert.equal(state.calls[createIndex - 1].args.at(-1), "refs/remotes/origin/cms-review-head");
  assert.equal(state.calls[createIndex + 1].tool, "git");
  assert.equal(state.calls[createIndex + 1].args[0], "fetch");
});

test("selects the exact candidate when a same-name fork PR is also returned", () => {
  const foreign = prFixture({
    number: 91,
    repository: "fork-owner/st-margaret-of-cortona-fraternity"
  });
  const legitimate = prFixture({ number: 17 });
  const { result, state } = runReviewHarness({
    prs: [foreign, legitimate]
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Reusing exact draft PR #17/);
  assert.equal(callsFor(state, "gh", "pr", "create").length, 0);
  assert.equal(callsFor(state, "gh", "api", "--method", "PATCH").length, 0);
  assert.equal(state.mainReads, state.cmsReads);
  assert.ok(state.mainReads >= 3);
});

test("rejects an exact candidate whose base SHA is not trusted", () => {
  const { result, state } = runReviewHarness({
    prs: [prFixture({ baseSha: "c".repeat(40) })]
  });

  assert.notEqual(result.status, 0);
  assert.equal(callsFor(state, "gh", "pr", "create").length, 0);
  assert.equal(callsFor(state, "gh", "api", "--method", "PATCH").length, 0);
});

test("fails closed when main moves during candidate reuse", () => {
  const movedMain = "c".repeat(40);
  const { result, state } = runReviewHarness({
    prs: [prFixture()],
    mainSequence: [trusted.trustedSha, movedMain]
  });

  assert.notEqual(result.status, 0);
  assert.equal(state.mainReads, 2);
  assert.equal(state.cmsReads, 1);
  assert.equal(callsFor(state, "git", "fetch").length, 2);
  assert.equal(callsFor(state, "gh", "pr", "create").length, 0);
  assert.equal(callsFor(state, "gh", "api", "--method", "PATCH").length, 0);
});

test("restores and verifies a wrong or missing body only on the exact candidate", () => {
  const missingBody = prFixture({ number: 18 });
  delete missingBody.body;

  for (const candidate of [
    prFixture({ number: 17, body: "Wrong body" }),
    missingBody
  ]) {
    const foreign = prFixture({
      number: 91,
      repository: "fork-owner/st-margaret-of-cortona-fraternity",
      body: "Foreign body"
    });
    const { result, state } = runReviewHarness({
      prs: [foreign, candidate]
    });

    assert.equal(result.status, 0, result.stderr);
    const patchCalls = callsFor(state, "gh", "api", "--method", "PATCH");
    assert.equal(patchCalls.length, 1);
    assert.ok(
      patchCalls[0].args.includes(
        `repos/${trusted.expectedRepository}/pulls/${candidate.number}`
      )
    );
    assert.ok(patchCalls[0].args.includes(`body=${approvedPrBody}`));
    assert.equal(
      state.prs.find((pr) => pr.number === candidate.number).body,
      approvedPrBody
    );
    assert.equal(state.prs.find((pr) => pr.number === 91).body, "Foreign body");

    const patchIndex = state.calls.indexOf(patchCalls[0]);
    assert.equal(state.calls[patchIndex - 1].tool, "git");
    assert.equal(
      state.calls[patchIndex - 1].args.at(-1),
      "refs/remotes/origin/cms-review-head"
    );
    assert.equal(state.calls[patchIndex + 1].tool, "git");
    assert.equal(state.calls[patchIndex + 1].args[0], "fetch");
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
