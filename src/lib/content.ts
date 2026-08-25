import { getCollection, type CollectionEntry } from "astro:content";

const byNavOrder = (
  a: CollectionEntry<"pages">,
  b: CollectionEntry<"pages">
) => a.data.navOrder - b.data.navOrder;

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) =>
  a.data.order - b.data.order;

const bySortDateDescending = (
  a: CollectionEntry<"resources">,
  b: CollectionEntry<"resources">
) =>
  b.data.sortDate.getTime() - a.data.sortDate.getTime() ||
  a.data.title.localeCompare(b.data.title);

export async function getPages() {
  const pages = await getCollection("pages");
  return pages.sort(byNavOrder);
}

export async function getPageByRoute(route: string) {
  const pages = await getPages();
  return pages.find((page) => page.data.route === route);
}

export async function requirePageByRoute(route: string) {
  const page = await getPageByRoute(route);

  if (!page) {
    throw new Error(`Missing page content for route: ${route}`);
  }

  return page;
}

export async function getPublishedFaqs() {
  const faqs = await getCollection("faqs", ({ data }) => data.published);
  return faqs.sort(byOrder);
}

export async function getPublishedResources() {
  const resources = await getCollection(
    "resources",
    ({ data }) => data.published
  );
  return resources.sort(bySortDateDescending);
}
