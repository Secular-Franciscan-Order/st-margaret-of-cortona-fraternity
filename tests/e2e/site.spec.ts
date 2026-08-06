import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );

  expect(overflow).toBeLessThanOrEqual(1);
}

test("serves the home page", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(
    "WELCOME TO THE ST MARGARET OF CORTONA FRATERNITY | St Margaret of Cortona Fraternity"
  );
  await expect(
    page.getByRole("heading", {
      name: "WELCOME TO THE ST MARGARET OF CORTONA FRATERNITY"
    })
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Saint Margaret of Cortona - A Franciscan Saint"
    })
  ).toHaveAttribute("src", "/uploads/images/st-margaret-of-cortona.jpg");
  await expect(page.getByText("Saint Thomas More Region")).toBeVisible();
});

test("serves each fixed content route", async ({ page }) => {
  const routes = [
    {
      path: "/who-we-are",
      heading: "Who We Are",
      text: "Saint Gabriel the Archangel Church"
    },
    {
      path: "/get-involved",
      heading: "Is God Calling You to the Secular Franciscan Order?",
      text: "To become a Secular Franciscan"
    },
    {
      path: "/news",
      heading: "Regional Franciscan News",
      text: "Early spring publication of Our Franciscan Scoop"
    }
  ];

  for (const route of routes) {
    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 })
    ).toBeVisible();
    await expect(page.getByText(route.text)).toBeVisible();
  }

  const faqResponse = await page.goto("/faq");

  expect(faqResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Q: WHO ARE THE FRANCISCANS?" })
  ).toBeVisible();
  await expect(
    page.getByText("Alternatiely email : hello@franciscanseculars.com")
  ).toBeVisible();
});

test("renders a contact form with static contact information", async ({ page }) => {
  await page.goto("/get-involved");

  const contact = page.locator(".contact-info");

  await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
  await expect(contact.getByText("Colleen Malloy, OFS")).toBeVisible();
  await expect(
    contact.getByRole("link", { name: "Colleen Malloy, OFS" })
  ).toHaveCount(0);
  await expect(contact.getByText("4240 Porticella Ave")).toHaveCount(0);
  await expect(contact.getByText("North Las Vegas, NV 89084")).toHaveCount(0);
  await expect(contact.getByText("917-594-0872")).toBeVisible();
  await expect(
    contact.getByRole("link", { name: "cmalloy925@gmail.com" })
  ).toBeVisible();
  await expect(page.getByLabel("First Name")).toBeVisible();
  await expect(page.getByLabel("Last Name")).toBeVisible();
  await expect(page.getByLabel(/Email/)).toHaveAttribute("required", "");
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
  await form.evaluate((element) => {
    const token = element.querySelector<HTMLInputElement>(
      '[name="cf-turnstile-response"]'
    ) ?? document.createElement("input");
    token.name = "cf-turnstile-response";
    token.value = "test-token";
    if (!token.parentElement) element.append(token);
  });

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

test("renders the approved location map on Who We Are", async ({ page }) => {
  await page.goto("/who-we-are");

  const mapSection = page.locator(".location-map");
  const map = page.getByTitle(
    "Map to St. Gabriel the Archangel Catholic Church"
  );

  await expect(
    page.getByRole("heading", { name: "Where We Meet" })
  ).toBeVisible();
  await expect(mapSection).toHaveCount(1);
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
  await expect(
    page.getByText("We meet on the second Sunday of each month")
  ).toBeVisible();
  await expect(
    page.getByText("Franciscan is spoken here. Peace and All Good to All !")
  ).toBeVisible();

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

  await expect(
    page.getByRole("heading", { name: "Q: WHO ARE THE FRANCISCANS?" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Q: WHAT IF I REALISE I’M NOT CALLED TO BE A SECULAR FRANCISCAN?"
    })
  ).toBeVisible();
  await expect(page.locator(".faq-entry")).toHaveCount(13);
});

test("renders resource links and text-only resources intentionally", async ({
  page
}) => {
  await page.goto("/news");

  await expect(
    page.getByRole("link", { name: "Summer publication" }).first()
  ).toHaveAttribute(
    "href",
    "https://www.stmregionofs.com/_files/ugd/9af1c7_9b9850224ce048f1b3f8ec01bcd755ff.pdf"
  );
  await expect(
    page.getByText(
      "Early summer publication of Our Franciscan Scoop for the St. Thomas More Region of of Secular Franciscan."
    )
  ).toBeVisible();
});

test("primary navigation links work", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "FAQ" })
    .click();
  await expect(page).toHaveURL("/faq");
  await expect(
    page.getByRole("heading", { name: "Q: WHO ARE THE FRANCISCANS?" })
  ).toBeVisible();
});

test("primary navigation mirrors the Wix page order", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const expectedLinks = ["Home", "Who We Are", "Get Involved", "News", "FAQ"];

  await expect(nav.getByRole("link")).toHaveText(expectedLinks);
});

test("keeps key layouts readable across configured viewports", async ({
  page
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Primary navigation" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "WELCOME TO THE ST MARGARET OF CORTONA FRATERNITY"
    })
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Saint Margaret of Cortona - A Franciscan Saint"
    })
  ).toBeVisible();
  await expect(page.locator(".home-hero__actions")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/faq");
  await expect(
    page.getByRole("heading", { name: "Q: WHO ARE THE FRANCISCANS?" })
  ).toBeVisible();
  await expect(page.locator(".faq-entry").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/news");
  await expect(
    page.getByRole("heading", { name: "Regional Franciscan News" })
  ).toBeVisible();
  await expect(page.locator(".news-entry").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Summer publication" }).first()
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/get-involved");
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
    "Page not found | St Margaret of Cortona Fraternity"
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
