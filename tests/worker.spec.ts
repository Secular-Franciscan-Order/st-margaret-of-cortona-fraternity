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
  CONTACT_RECIPIENT: "cmalloy925@gmail.com",
  CONTACT_SECONDARY_RECIPIENT: "susan.kowalski@unlv.edu",
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

const verifiedContactRequest = () =>
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
  });

const withVerifiedTurnstile = async (callback: () => Promise<void>) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ success: true, hostname: "stmargaretofcortona.endian.dev" }),
      { headers: { "Content-Type": "application/json" } }
    );

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("sends a verified submission to both configured recipients", async () => {
  await withVerifiedTurnstile(async () => {
    const sentMessages: Array<{ to: string | { email: string; name?: string } }> = [];
    const response = await worker.fetch(verifiedContactRequest(), {
      ...env,
      CONTACT_EMAIL: {
        send: async (message) => {
          sentMessages.push({ to: message.to });
        }
      }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(sentMessages, [
      { to: env.CONTACT_RECIPIENT },
      { to: env.CONTACT_SECONDARY_RECIPIENT }
    ]);
  });
});

for (const failingRecipient of [env.CONTACT_RECIPIENT, env.CONTACT_SECONDARY_RECIPIENT]) {
  test(`reports success when delivery to ${failingRecipient} fails`, async () => {
    await withVerifiedTurnstile(async () => {
      const attemptedRecipients: Array<string | { email: string; name?: string }> = [];
      const response = await worker.fetch(verifiedContactRequest(), {
        ...env,
        CONTACT_EMAIL: {
          send: async (message) => {
            attemptedRecipients.push(message.to);

            if (message.to === failingRecipient) {
              throw new Error("delivery failed");
            }
          }
        }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(attemptedRecipients, [
        env.CONTACT_RECIPIENT,
        env.CONTACT_SECONDARY_RECIPIENT
      ]);
    });
  });
}

test("reports failure only when delivery to both recipients fails", async () => {
  await withVerifiedTurnstile(async () => {
    const attemptedRecipients: Array<string | { email: string; name?: string }> = [];
    const response = await worker.fetch(verifiedContactRequest(), {
      ...env,
      CONTACT_EMAIL: {
        send: async (message) => {
          attemptedRecipients.push(message.to);
          throw new Error("delivery failed");
        }
      }
    });

    assert.equal(response.status, 500);
    assert.deepEqual(attemptedRecipients, [
      env.CONTACT_RECIPIENT,
      env.CONTACT_SECONDARY_RECIPIENT
    ]);
  });
});
