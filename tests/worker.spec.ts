import assert from "node:assert/strict";
import { test } from "node:test";

import worker from "../src/worker.ts";

const origin = "https://stmargaretofcortona.endian.dev";
const oversizedBody = new TextEncoder().encode("x".repeat(10_001));

interface DeliveredMessage {
  readonly to: string | { readonly email: string; readonly name?: string };
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly replyTo: string | { readonly email: string; readonly name?: string };
}

const env = {
  ASSETS: {
    fetch: async () => new Response("not used")
  },
  CONTACT_EMAIL: {
    send: async () => undefined
  },
  CONTACT_RECIPIENT: "cmalloy925@gmail.com",
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

const submitVerified = async (phone?: string) => {
  const originalFetch = globalThis.fetch;
  const sentMessages: DeliveredMessage[] = [];
  const body = new URLSearchParams({
    email: "visitor@example.com",
    message: "Hello",
    "cf-turnstile-response": "test-token"
  });

  if (phone !== undefined) body.set("phone", phone);

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
        body
      }),
      {
        ...env,
        CONTACT_EMAIL: {
          send: async ({ to, subject, text, html, replyTo }) => {
            sentMessages.push({ to, subject, text, html, replyTo });
          }
        }
      }
    );

    return { response, sentMessages };
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const assertUnchangedRouting = (message: DeliveredMessage) => {
  assert.equal(message.to, env.CONTACT_RECIPIENT);
  assert.equal(message.subject, "New contact form message");
  assert.equal(message.replyTo, "visitor@example.com");
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

for (const [label, phone] of [
  ["omitted", undefined],
  ["empty", ""],
  ["whitespace-only", "   "]
] as const) {
  test(`uses Not provided when phone is ${label}`, async () => {
    // Given a verified submission with no meaningful phone value
    // When the Worker delivers the contact email
    const { response, sentMessages } = await submitVerified(phone);

    // Then delivery succeeds with an explicit fallback and unchanged routing
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 1);
    const [message] = sentMessages;
    assert.ok(message);
    assertUnchangedRouting(message);
    assert.equal(
      message.text,
      "Name: Not provided\nEmail: visitor@example.com\nPhone: Not provided\n\nMessage:\nHello"
    );
    assert.equal(
      message.html,
      "<h1>New contact form message</h1><p><strong>Name:</strong> Not provided</p><p><strong>Email:</strong> visitor@example.com</p><p><strong>Phone:</strong> Not provided</p><p><strong>Message:</strong><br>Hello</p>"
    );
  });
}

test("preserves a valid phone value after trimming", async () => {
  // Given a verified submission with common phone formatting and surrounding whitespace
  // When the Worker delivers the contact email
  const { response, sentMessages } = await submitVerified("  +1 (702) 555-0100  ");

  // Then the formatting is preserved and routing remains unchanged
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  const [message] = sentMessages;
  assert.ok(message);
  assertUnchangedRouting(message);
  assert.match(message.text, /\nPhone: \+1 \(702\) 555-0100\n\nMessage:/);
  assert.match(message.html, /<strong>Phone:<\/strong> \+1 \(702\) 555-0100<\/p>/);
});

test("delivers a malformed phone value without rejection", async () => {
  // Given a verified submission containing a malformed phone value
  // When the Worker delivers the contact email
  const { response, sentMessages } = await submitVerified("not-a-phone");

  // Then the malformed value is delivered and routing remains unchanged
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  const [message] = sentMessages;
  assert.ok(message);
  assertUnchangedRouting(message);
  assert.match(message.text, /\nPhone: not-a-phone\n\nMessage:/);
  assert.match(message.html, /<strong>Phone:<\/strong> not-a-phone<\/p>/);
});

test("escapes phone markup only in the HTML email", async () => {
  // Given a verified submission containing markup in the phone value
  const markup = "<img src=x onerror=alert(1)>";

  // When the Worker delivers the contact email
  const { response, sentMessages } = await submitVerified(markup);

  // Then plain text stays literal while HTML is escaped and routing remains unchanged
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  const [message] = sentMessages;
  assert.ok(message);
  assertUnchangedRouting(message);
  assert.match(message.text, /\nPhone: <img src=x onerror=alert\(1\)>\n\nMessage:/);
  assert.match(
    message.html,
    /<strong>Phone:<\/strong> &lt;img src=x onerror=alert\(1\)&gt;<\/p>/
  );
  assert.equal(message.html.includes("<img"), false);
});

test("slices an overlength phone value to 32 characters", async () => {
  // Given a verified submission containing 100 numeric characters
  const expectedPhone = "1".repeat(32);

  // When the Worker delivers the contact email
  const { response, sentMessages } = await submitVerified("1".repeat(100));

  // Then exactly the first 32 characters are delivered and routing remains unchanged
  assert.equal(response.status, 200);
  assert.equal(sentMessages.length, 1);
  const [message] = sentMessages;
  assert.ok(message);
  assertUnchangedRouting(message);
  assert.match(message.text, new RegExp(`\\nPhone: ${expectedPhone}\\n\\nMessage:`));
  assert.match(message.html, new RegExp(`<strong>Phone:</strong> ${expectedPhone}</p>`));
});
