interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface EmailAddress {
  email: string;
  name?: string;
}

interface ContactEmail {
  send(message: {
    to?: string | EmailAddress;
    from: string | EmailAddress;
    subject: string;
    text: string;
    html: string;
    replyTo: string | EmailAddress;
  }): Promise<unknown>;
}

interface Env {
  ASSETS: AssetFetcher;
  CONTACT_EMAIL: ContactEmail;
  TURNSTILE_SECRET_KEY: string;
}

const allowedHosts = new Set([
  "stmargaretofcortona.endian.dev",
  "stmargaretofcortona.com",
  "www.stmargaretofcortona.com"
]);

const maxRequestSize = 10_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: { message: string }, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });

const getText = (formData: FormData, name: string, maxLength: number) => {
  const value = formData.get(name);

  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
};

const readBoundedBody = async (
  request: Request
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const reader = request.body?.getReader();

  if (!reader) return new Uint8Array(new ArrayBuffer(0));

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      if (!value) continue;

      if (value.byteLength > maxRequestSize - size) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    };

    return entities[character];
  });

const verifyTurnstile = async (
  token: string,
  secret: string,
  remoteIp: string | null
) => {
  const verificationBody = new FormData();
  verificationBody.set("secret", secret);
  verificationBody.set("response", token);

  if (remoteIp) verificationBody.set("remoteip", remoteIp);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: verificationBody }
    );
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
    };

    return response.ok && result.success === true && allowedHosts.has(result.hostname ?? "");
  } catch {
    return false;
  }
};

const handleContactRequest = async (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  const contentLength = Number(request.headers.get("Content-Length"));

  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  if (
    !origin ||
    !(() => {
      try {
        return new URL(origin).protocol === "https:" && allowedHosts.has(new URL(origin).hostname);
      } catch {
        return false;
      }
    })()
  ) {
    return json({ message: "This request is not allowed." }, 403);
  }

  if (Number.isFinite(contentLength) && contentLength > maxRequestSize) {
    return json({ message: "Your message is too large." }, 413);
  }

  let body: Uint8Array<ArrayBuffer> | null;
  let formData: FormData;

  try {
    body = await readBoundedBody(request);
  } catch {
    return json({ message: "We could not read your message." }, 400);
  }

  if (!body) {
    return json({ message: "Your message is too large." }, 413);
  }

  try {
    const contentType = request.headers.get("Content-Type");

    if (!contentType) {
      return json({ message: "We could not read your message." }, 400);
    }

    formData = await new Response(body, {
      headers: { "Content-Type": contentType }
    }).formData();
  } catch {
    return json({ message: "We could not read your message." }, 400);
  }

  const firstName = getText(formData, "first-name", 100);
  const lastName = getText(formData, "last-name", 100);
  const email = getText(formData, "email", 250).toLowerCase();
  const message = getText(formData, "message", 5_000);
  const website = getText(formData, "website", 200);
  const turnstileToken = getText(formData, "cf-turnstile-response", 2_048);

  if (website) {
    return json({ message: "Thank you. Your message has been sent." });
  }

  if (!emailPattern.test(email)) {
    return json({ message: "Please enter a valid email address." }, 400);
  }

  if (!turnstileToken) {
    return json({ message: "Please complete the verification before sending your message." }, 400);
  }

  const verified = await verifyTurnstile(
    turnstileToken,
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP")
  );

  if (!verified) {
    return json({ message: "Verification expired or failed. Please try again." }, 400);
  }

  const visitorName = [firstName, lastName].filter(Boolean).join(" ") || "Not provided";
  const safeName = escapeHtml(visitorName);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message || "Not provided").replace(/\n/g, "<br>");

  try {
    await env.CONTACT_EMAIL.send({
      from: {
        email: "contact@stmargaretofcortona.com",
        name: "St. Margaret of Cortona Fraternity"
      },
      subject: "New contact form message",
      text: `Name: ${visitorName}\nEmail: ${email}\n\nMessage:\n${message || "Not provided"}`,
      html: `<h1>New contact form message</h1><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Message:</strong><br>${safeMessage}</p>`,
      replyTo: email
    });
  } catch {
    return json(
      { message: "We could not send your message. Please try again or use the contact details above." },
      500
    );
  }

  return json({ message: "Thank you. Your message has been sent." });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact") {
      return handleContactRequest(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
