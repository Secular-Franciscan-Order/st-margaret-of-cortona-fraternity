import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const isRouteSegment = (segment: string) =>
  segment.length > 0 &&
  !segment.startsWith("-") &&
  !segment.endsWith("-") &&
  !segment.includes("--") &&
  Array.from(segment).every(
    (char) =>
      (char >= "a" && char <= "z") ||
      (char >= "0" && char <= "9") ||
      char === "-"
  );

const pageRoute = z.string().refine(
  (route) => {
    if (route === "/") {
      return true;
    }

    if (!route.startsWith("/") || route.endsWith("/")) {
      return false;
    }

    return route.slice(1).split("/").every(isRouteSegment);
  },
  { message: "Route must be / or a lowercase path such as /who-we-are." }
);

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isUploadedPdfPath = (value: string) => {
  if (value === "") {
    return true;
  }

  const prefix = "/uploads/documents/";

  if (!value.startsWith(prefix)) {
    return false;
  }

  const filename = value.slice(prefix.length);

  return (
    filename.length > 4 &&
    filename.toLowerCase().endsWith(".pdf") &&
    !filename.includes("..") &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    Array.from(filename).every(
      (char) =>
        (char >= "a" && char <= "z") ||
        (char >= "A" && char <= "Z") ||
        (char >= "0" && char <= "9") ||
        char === "-" ||
        char === "_" ||
        char === "."
    )
  );
};

const optionalHttpUrl = z
  .string()
  .optional()
  .default("")
  .refine((value) => value === "" || isHttpUrl(value), {
    message: "External URL must be empty or start with http:// or https://."
  });

const optionalUploadedPdfPath = z
  .string()
  .optional()
  .default("")
  .refine(isUploadedPdfPath, {
    message:
      "Uploaded file must be empty or a PDF path under /uploads/documents/."
  });

const pages = defineCollection({
  loader: glob({ base: "./src/content/pages", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    route: pageRoute,
    navLabel: z.string(),
    navOrder: z.number(),
    description: z.string().default("")
  })
});

const faqs = defineCollection({
  loader: glob({ base: "./src/content/faqs", pattern: "**/*.md" }),
  schema: z.object({
    question: z.string(),
    order: z.number(),
    published: z.boolean().default(true)
  })
});

const resources = defineCollection({
  loader: glob({ base: "./src/content/resources", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    linkLabel: z.string().optional().default(""),
    uploadedFile: optionalUploadedPdfPath,
    externalUrl: optionalHttpUrl,
    published: z.boolean().default(true)
  })
});

export const collections = { pages, faqs, resources };
