import { slugify } from "./textConverter";

type SlugSource = {
  id?: string;
  data?: { slug?: string; title?: string };
};

/**
 * Canonical URL slug for a directory entry.
 *
 * Defaults to the filename-derived collection id. A `slug:` field in the
 * listing's frontmatter overrides it — that override is documented in
 * `src/content/directory/-template.md`, so it has to be honoured here rather
 * than silently ignored.
 *
 * Every place that builds a `/directory/<slug>/` URL — routes, cards, JSON-LD,
 * the .md companions, llms.txt — must go through this helper, or the generated
 * routes and the links pointing at them drift apart.
 */
export const entrySlug = (entry: SlugSource): string =>
  entry.data?.slug?.trim() || entry.id || slugify(entry.data?.title || "vendor");
