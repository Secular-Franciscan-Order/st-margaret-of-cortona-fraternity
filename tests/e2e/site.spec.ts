import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  expectedDocumentTitle,
  loadCmsExpectations,
  normalizeRenderedTypography,
  requirePageExpectation,
  type MarkdownBodyExpectation
} from "../helpers/cms-expectations.ts";

const cms = loadCmsExpectations();
const homePage = requirePageExpectation(cms, "/");
const faqPage = requirePageExpectation(cms, "/faq");
const newsPage = requirePageExpectation(cms, "/news");
const getInvolvedPage = requirePageExpectation(cms, "/get-involved");

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );

  expect(overflow).toBeLessThanOrEqual(1);
}

async function injectSyntheticTurnstile(form: Locator) {
  await form.evaluate((element) => {
    const token = element.querySelector<HTMLInputElement>(
      '[name="cf-turnstile-response"]'
    ) ?? document.createElement("input");
    token.name = "cf-turnstile-response";
    token.value = "test-token";
    if (!token.parentElement) element.append(token);
  });
}

async function expectRenderedCmsBody(
  container: Locator,
  body: MarkdownBodyExpectation,
  templateElementCount = 1
) {
  const directChildren = container.locator(":scope > *");

  await expect(directChildren).toHaveCount(
    templateElementCount + body.renderedBlockCount
  );

  for (const [blockIndex, block] of body.blocks.entries()) {
    const renderedBlock = directChildren.nth(templateElementCount + blockIndex);
    const authoredLinks = renderedBlock.locator("a");

    await expect(renderedBlock).toHaveJSProperty(
      "tagName",
      block.tagName.toUpperCase()
    );

    const renderedText = normalizeRenderedTypography(
      (await renderedBlock.textContent()) ?? ""
    );

    for (const text of block.authoredTextSegments) {
      expect(renderedText).toContain(normalizeRenderedTypography(text));
    }

    await expect(authoredLinks).toHaveCount(block.authoredLinkHrefs.length);

    for (const [linkIndex, href] of block.authoredLinkHrefs.entries()) {
      await expect(authoredLinks.nth(linkIndex)).toHaveAttribute("href", href);
    }

    const authoredImages = renderedBlock.locator("img");
    await expect(authoredImages).toHaveCount(block.authoredImages.length);

    for (const [imageIndex, image] of block.authoredImages.entries()) {
      await expect(authoredImages.nth(imageIndex)).toHaveAttribute(
        "src",
        image.src
      );
      await expect(authoredImages.nth(imageIndex)).toHaveAttribute(
        "alt",
        image.alt
      );
    }
  }
}

test("serves the home page with source-backed content", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(
    expectedDocumentTitle(homePage.title, cms.site.name)
  );
  const homeContent = page.locator(".home-page");
  await expect(homeContent.locator(":scope > h1:first-child")).toHaveText(
    homePage.title
  );
  await expect(homeContent).toBeVisible();
  await expectRenderedCmsBody(homeContent, homePage.body);

  const portrait = page.locator(".home-portrait");

  if (cms.site.homeHero.image) {
    await expect(portrait).toHaveAttribute("src", cms.site.homeHero.image);
    await expect(portrait).toHaveAttribute("alt", cms.site.homeHero.imageAlt);
  } else {
    await expect(portrait).toHaveCount(0);
  }
});

test("serves each fixed content route", async ({ page }) => {
  const routes = [
    { path: "/who-we-are", container: ".markdown-page", rendersBody: true },
    { path: "/get-involved", container: ".markdown-page", rendersBody: true },
    { path: "/news", container: ".news-page", rendersBody: false },
    { path: "/faq", container: ".faq-page", rendersBody: true }
  ];

  for (const route of routes) {
    const expectedPage = requirePageExpectation(cms, route.path);
    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      expectedDocumentTitle(expectedPage.title, cms.site.name)
    );
    const content = page.locator(route.container);
    await expect(content.locator(":scope > h1:first-child")).toHaveText(
      expectedPage.title
    );
    if (route.rendersBody) {
      await expectRenderedCmsBody(content, expectedPage.body);
    }
  }
});

test("renders a contact form with source-backed contact information", async ({
  page
}) => {
  await page.goto("/get-involved");

  const contact = page.locator(".contact-info");

  await expect(contact.locator(":scope > h2:first-child")).toHaveText("Contact");
  await expect(contact.getByText(cms.site.contact.name, { exact: true })).toBeVisible();
  await expect(
    contact.getByRole("link", { name: cms.site.contact.name, exact: true })
  ).toHaveCount(0);
  await expect(contact.getByText("4240 Porticella Ave")).toHaveCount(0);
  await expect(contact.getByText("North Las Vegas, NV 89084")).toHaveCount(0);
  await expect(contact.getByText(cms.site.contact.phone, { exact: true })).toBeVisible();
  await expect(
    contact.getByRole("link", { name: cms.site.contact.email, exact: true })
  ).toHaveAttribute("href", `mailto:${cms.site.contact.email}`);
  await expect(page.getByLabel("First Name")).toBeVisible();
  await expect(page.getByLabel("Last Name")).toBeVisible();
  await expect(page.getByLabel(/Email/)).toHaveAttribute("required", "");
  const phone = page.getByLabel("Phone (optional)", { exact: true });
  await expect(phone).toBeVisible();
  await expect(phone).toHaveAttribute("id", "contact-phone");
  await expect(phone).toHaveAttribute("name", "phone");
  await expect(phone).toHaveAttribute("type", "tel");
  await expect(phone).toHaveAttribute("inputmode", "tel");
  await expect(phone).toHaveAttribute("autocomplete", "tel");
  await expect(phone).toHaveAttribute("maxlength", "32");
  await expect(phone).toHaveAttribute(
    "pattern",
    String.raw`\+?\(?[0-9][0-9\(\) \.\-]{5,28}[0-9]`
  );
  await expect(phone).not.toHaveAttribute("required", "");
  await expect(phone).not.toHaveAttribute("placeholder", /.*/);
  await expect(phone).not.toHaveAttribute("title", /.*/);
  expect(
    await page
      .locator("#contact-email, #contact-phone, #contact-message")
      .evaluateAll((elements) => elements.map(({ id }) => id))
  ).toEqual(["contact-email", "contact-phone", "contact-message"]);
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(page.locator(".cf-turnstile")).toHaveAttribute(
    "data-sitekey",
    "0x4AAAAAAEERQmwQp-jP4ygz"
  );
});

test("shows contact form submission feedback in the action area", async ({ page }) => {
  await page.route("**/api/contact", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Thank you. Your message has been sent." })
    });
  });
  await page.goto("/get-involved");

  const form = page.locator(".contact-form");
  await page.getByLabel(/Email/).fill("visitor@example.com");
  await injectSyntheticTurnstile(form);

  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Sending your message" })).toBeDisabled();
  await expect(form.getByText("Sending…")).toBeVisible();
  const success = form.locator(".contact-form__success");
  await expect(success).toBeVisible();
  await expect(success).toHaveCSS("justify-self", "center");
  await expect(success).toHaveCSS("text-align", "center");
  await expect(form.locator(".contact-form__content")).toBeHidden();
  await expect(form.locator(".cf-turnstile")).toBeHidden();
  await expect(
    form.getByRole("button", { name: "Send another message" })
  ).toBeVisible();

  await form.getByRole("button", { name: "Send another message" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(form.locator(".cf-turnstile")).toBeVisible();
});

test("submits a valid optional phone in contact form data", async ({ page }) => {
  let submittedPhone: FormDataEntryValue | null = null;
  await page.route("**/api/contact", async (route) => {
    const body = route.request().postDataBuffer();
    const contentType = await route.request().headerValue("content-type");

    expect(body).not.toBeNull();
    expect(contentType).not.toBeNull();
    if (body === null || contentType === null) {
      await route.abort();
      return;
    }

    const formData = await new Response(Uint8Array.from(body).buffer, {
      headers: { "content-type": contentType }
    }).formData();
    submittedPhone = formData.get("phone");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Thank you. Your message has been sent." })
    });
  });
  await page.goto("/get-involved");

  const form = page.locator(".contact-form");
  await page.getByLabel(/Email/).fill("visitor@example.com");
  await page.getByLabel("Phone (optional)").fill("+1 (702) 555-0100");
  await injectSyntheticTurnstile(form);

  await page.getByRole("button", { name: "Send message" }).click();

  await expect(form.locator(".contact-form__success")).toBeVisible();
  expect(submittedPhone).toBe("+1 (702) 555-0100");
});

test("blocks an invalid contact phone before the API request", async ({ page }) => {
  let contactApiCalls = 0;
  await page.route("**/api/contact", async (route) => {
    contactApiCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Unexpected request." })
    });
  });
  await page.goto("/get-involved");

  const form = page.locator(".contact-form");
  const phone = page.getByLabel("Phone (optional)");
  await page.getByLabel(/Email/).fill("visitor@example.com");
  await phone.fill("not-a-phone");
  await injectSyntheticTurnstile(form);

  await page.getByRole("button", { name: "Send message" }).click();

  expect(
    await page.evaluate(
      () =>
        document.querySelector<HTMLInputElement>("#contact-phone")?.validity
          .patternMismatch
    )
  ).toBe(true);
  await expect(form.locator(".contact-form__success")).toBeHidden();
  expect(contactApiCalls).toBe(0);
});

test("renders the approved location map on Who We Are", async ({ page }) => {
  await page.goto("/who-we-are");

  const mapSection = page.locator(".location-map");
  const map = mapSection.getByTitle(
    "Map to St. Gabriel the Archangel Catholic Church"
  );

  await expect(mapSection).toHaveCount(1);
  await expect(mapSection.locator(":scope > h2:first-child")).toHaveText(
    "Where We Meet"
  );
  await expect(map).toHaveCount(1);
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute(
    "src",
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3225.1709972320523!2d-115.12414712419509!3d36.064933072466!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x80c8cf8dbd7bbb27%3A0x79aa173c20f43d86!2sSt.%20Gabriel%20the%20Archangel%20Catholic%20Church!5e0!3m2!1sen!2sus!4v1782250735295!5m2!1sen!2sus"
  );
  await expect(map).toHaveAttribute("loading", "lazy");
  await expect(map).toHaveAttribute(
    "referrerpolicy",
    "strict-origin-when-cross-origin"
  );
  await expect(map).toHaveAttribute("allowfullscreen", "");
  await expect(page.locator(".markdown-page")).toBeVisible();

  const markdownBounds = await page.locator(".markdown-page").boundingBox();
  const mapBounds = await mapSection.boundingBox();

  expect(markdownBounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  expect(Math.abs(mapBounds!.x - markdownBounds!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(mapBounds!.width - markdownBounds!.width)).toBeLessThanOrEqual(
    1
  );
  await expectNoHorizontalOverflow(page);

  await page.goto("/get-involved");
  await expect(page.locator(".location-map")).toHaveCount(0);
});

test("renders FAQ entries from the content collection", async ({ page }) => {
  await page.goto("/faq");

  const entries = page.locator(".faq-entry");
  await expect(entries).toHaveCount(cms.publishedFaqs.length);

  for (const [index, faq] of cms.publishedFaqs.entries()) {
    const entry = entries.nth(index);
    await expect(entry.locator(":scope > h2:first-child")).toHaveText(
      `Q: ${faq.question}`
    );
    await expectRenderedCmsBody(entry, faq.body);
  }
});

test("renders resource links and text-only resources intentionally", async ({
  page
}) => {
  await page.goto("/news");

  const entries = page.locator(".news-entry");

  await expect(entries).toHaveCount(cms.publishedResources.length);

  for (const [index, resource] of cms.publishedResources.entries()) {
    const entry = entries.nth(index);
    const description = entry.locator(":scope > .news-entry__description");
    const structuredLink = description.locator(":scope > a:first-child");

    await expect(entry.locator(":scope > h2:first-child")).toHaveText(
      resource.title
    );

    if (resource.href) {
      await expect(structuredLink).toHaveText(resource.renderedLinkLabel);
      await expect(structuredLink).toHaveAttribute("href", resource.href);
    } else {
      await expect(structuredLink).toHaveCount(0);
    }

    await expectRenderedCmsBody(description, resource.body, resource.href ? 1 : 0);
  }
});

test("primary navigation links work", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.locator('a[href="/faq"]').click();
  await expect(page).toHaveURL("/faq");
  await expect(page.locator(".faq-page > h1:first-child")).toHaveText(
    faqPage.title
  );
});

test("primary navigation follows source-defined order", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const links = nav.getByRole("link");

  await expect(links).toHaveText(cms.pages.map(({ navLabel }) => navLabel));
  await expect(links).toHaveCount(cms.pages.length);

  for (const [index, expectedPage] of cms.pages.entries()) {
    await expect(links.nth(index)).toHaveAttribute("href", expectedPage.route);
  }
});

test("keeps key layouts readable across configured viewports", async ({
  page
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Primary navigation" })
  ).toBeVisible();
  await expect(page.locator(".home-page > h1:first-child")).toHaveText(
    homePage.title
  );
  if (cms.site.homeHero.image) {
    await expect(page.locator(".home-portrait")).toBeVisible();
  } else {
    await expect(page.locator(".home-portrait")).toHaveCount(0);
  }
  await expect(page.locator(".home-hero__actions")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/faq");
  await expect(page.locator(".faq-page > h1:first-child")).toHaveText(
    faqPage.title
  );
  await expect(page.locator(".faq-entry")).toHaveCount(cms.publishedFaqs.length);
  if (cms.publishedFaqs.length > 0) {
    await expect(page.locator(".faq-entry").first()).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  await page.goto("/news");
  await expect(page.locator(".news-page > h1:first-child")).toHaveText(
    newsPage.title
  );
  await expect(page.locator(".news-entry")).toHaveCount(
    cms.publishedResources.length
  );
  if (cms.publishedResources.length > 0) {
    await expect(page.locator(".news-entry").first()).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  await page.goto("/get-involved");
  await expect(page.locator(".markdown-page > h1:first-child")).toHaveText(
    getInvolvedPage.title
  );
  await expect(page.locator(".site-footer")).not.toContainText(
    "4240 Porticella Ave"
  );
  await expect(page.locator(".site-footer")).not.toContainText(
    "Proudly created with Wix.com"
  );
  await expect(page.locator(".footer-credit")).toHaveCount(0);
  await expect(page.locator(".contact-info")).not.toContainText(
    "4240 Porticella Ave"
  );
  await expect(page.locator(".contact-info")).not.toContainText(
    "North Las Vegas, NV 89084"
  );
  await expectNoHorizontalOverflow(page);
});

test("serves the custom 404 page for missing routes", async ({ page }) => {
  const response = await page.goto("/missing-page");

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(
    expectedDocumentTitle("Page not found", cms.site.name)
  );
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible();
});

test("treats the Wix fullscreen placeholder route as not found", async ({
  page
}) => {
  const response = await page.goto("/fullscreen-page");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible();
});
