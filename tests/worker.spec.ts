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
  CONTACT_RECIPIENT: "cj.ofs@hulu.casa",
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

test("sends a verified submission to the configured recipient", async () => {
  const originalFetch = globalThis.fetch;
  const sentMessages: Array<{ to: string | { email: string; name?: string } }> = [];

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ success: true, hostname: "stmargaretofcortona.endian.dev" }),
      { headers: { "Content-Type": "application/json" } }
    );

  try {
    const response = await worker.fetch(
      new Request(`${origin}/api/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: origin
        },
        body: new URLSearchParams({
          email: "visitor@example.com",
          message: "Hello",
          "cf-turnstile-response": "test-token"
        })
      }),
      {
        ...env,
        CONTACT_EMAIL: {
          send: async (message) => {
            sentMessages.push({ to: message.to });
          }
        }
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(sentMessages, [{ to: env.CONTACT_RECIPIENT }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
