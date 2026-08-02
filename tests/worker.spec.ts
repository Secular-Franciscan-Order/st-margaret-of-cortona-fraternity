import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.ts";

const origin = "https://stmargaretofcortona.endian.dev";
const oversizedBody = new TextEncoder().encode("x".repeat(10_001));

const env = {
  ASSETS: {
    fetch: async () => new Response("not used")
  },
  CONTACT_EMAIL: {
    send: async () => undefined
  },
  TURNSTILE_SECRET_KEY: "not-used"
};

const oversizedRequest = (contentLength?: string) => {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    Origin: origin
  });

  if (contentLength) headers.set("Content-Length", contentLength);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversizedBody);
      controller.close();
    }
  });

  return new Request(`${origin}/api/contact`, {
    method: "POST",
    headers,
    body,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
};

test("rejects an oversized request without Content-Length", async () => {
  const response = await worker.fetch(oversizedRequest(), env);

  assert.equal(response.status, 413);
  await assert.doesNotReject(response.json());
});

test("rejects an oversized request with an understated Content-Length", async () => {
  const response = await worker.fetch(oversizedRequest("1"), env);

  assert.equal(response.status, 413);
  await assert.doesNotReject(response.json());
});
