import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SAFE_CMS_BRANCH = /^cms\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function validateCmsBranch(branch) {
  if (
    !SAFE_CMS_BRANCH.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock")
  ) {
    throw new Error("Pages CMS action must target a safe cms/** branch.");
  }
}

export function parseCmsReviewPayload(
  source,
  { expectedRepository, trustedRef, trustedSha }
) {
  if (Buffer.byteLength(source, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Pages CMS action payload exceeds the 64 KiB limit.");
  }
  if (trustedRef !== "refs/heads/main" || !FULL_SHA.test(trustedSha || "")) {
    throw new Error("CMS review workflow must execute from an exact trusted main commit.");
  }

  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error("Pages CMS action payload must be valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Pages CMS action payload must be one JSON object.");
  }
  if (payload.source !== "pages-cms") {
    throw new Error("CMS review workflow accepts only Pages CMS action payloads.");
  }
  if (payload.action?.name !== "open-review-pr") {
    throw new Error("CMS review workflow accepts only the Open review PR action.");
  }

  const [expectedOwner, expectedRepo, extra] = requiredString(
    expectedRepository,
    "Expected repository"
  ).split("/");
  if (!expectedOwner || !expectedRepo || extra) {
    throw new Error("Expected repository must use owner/name form.");
  }

  const repository = payload.repository;
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    throw new Error("Pages CMS action payload must contain repository metadata.");
  }
  if (repository.owner !== expectedOwner || repository.repo !== expectedRepo) {
    throw new Error("Pages CMS action repository must match this repository.");
  }
  if (repository.workflowRef !== "main") {
    throw new Error("Pages CMS action must dispatch cms-review.yml from main.");
  }

  const workflowSha = requiredString(
    repository.sha,
    "Pages CMS workflow SHA"
  );
  if (!FULL_SHA.test(workflowSha)) {
    throw new Error(
      "Pages CMS workflow SHA must be an exact 40-character commit SHA."
    );
  }
  if (workflowSha !== trustedSha) {
    throw new Error(
      "Pages CMS workflow SHA must match the exact trusted main revision."
    );
  }

  const branch = requiredString(repository.ref, "Pages CMS branch");
  validateCmsBranch(branch);

  return { branch };
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const result = parseCmsReviewPayload(process.env.CMS_ACTION_PAYLOAD || "", {
      expectedRepository: process.env.GITHUB_REPOSITORY || "",
      trustedRef: process.env.TRUSTED_REF || "",
      trustedSha: process.env.TRUSTED_SHA || ""
    });
    const output = requiredString(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
    appendFileSync(output, `branch=${result.branch}\n`, "utf8");
    console.log(
      `Validated Pages CMS review request for ${result.branch} from trusted main ${process.env.TRUSTED_SHA}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
