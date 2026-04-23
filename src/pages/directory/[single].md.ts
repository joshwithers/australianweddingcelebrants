// Markdown counterpart to src/pages/directory/[single].astro. Served directly
// at /directory/<slug>.md and swapped in by functions/_middleware.js when the
// request carries Accept: text/markdown.

import type { APIRoute, GetStaticPaths } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { slugify } from "@/lib/utils/textConverter";

const SITE = "https://australianweddingcelebrants.com.au";

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getSinglePage("directory");
  return entries.map((entry) => ({
    params: { single: entry.id || slugify(entry.data?.title || "vendor") },
    props: { entry },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const entry = props.entry as Awaited<ReturnType<typeof getSinglePage<"directory">>>[number];
  const d = entry.data;
  const slug = entry.id;

  const tierLabel = {
    luminary: "Luminary",
    endorsed: "Endorsed",
    registered: "Registered",
  }[d.tier || "registered"];

  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  if (d.description) lines.push("", `> ${d.description}`);
  lines.push("", `**Tier:** ${tierLabel}`);
  if (d.location?.length) lines.push(`**Serves:** ${d.location.join(", ")}`);
  if (d.category?.length) lines.push(`**Specialties:** ${d.category.join(", ")}`);
  if (d.australia_wide) lines.push("**Travels:** Australia-wide");
  if (d.international) lines.push("**Travels:** International / destination weddings");
  if (d.year_started) lines.push(`**Working since:** ${d.year_started}`);

  const contact: string[] = [];
  if (d.website) contact.push(`- Website: ${d.website}`);
  if (d.email) contact.push(`- Email: ${d.email}`);
  if (d.phone) contact.push(`- Phone: ${d.phone}`);
  if (d.address) contact.push(`- Address: ${d.address}`);
  if (contact.length) {
    lines.push("", "## Contact", ...contact);
  }

  const social: string[] = [];
  if (d.social?.facebook) social.push(`- Facebook: ${d.social.facebook}`);
  if (d.social?.instagram) social.push(`- Instagram: ${d.social.instagram}`);
  if (d.social?.pinterest) social.push(`- Pinterest: ${d.social.pinterest}`);
  if (social.length) {
    lines.push("", "## Social", ...social);
  }

  if (Array.isArray(d.awards) && d.awards.length) {
    lines.push("", "## Awards");
    for (const a of d.awards) {
      const parts = [`${a.year} — ${a.title}`];
      if (a.region) parts.push(`(${a.region})`);
      if (a.note) parts.push(`— ${a.note}`);
      lines.push(`- ${parts.join(" ")}`);
    }
  }

  if (Array.isArray(d.testimonials) && d.testimonials.length) {
    lines.push("", "## Testimonials");
    for (const t of d.testimonials) {
      const attribution = t.role ? `${t.author}, ${t.role}` : t.author;
      lines.push("", `> ${t.quote}`, `> — ${attribution}`);
    }
  }

  if (entry.body) {
    lines.push("", "## About", "", entry.body.trim());
  }

  lines.push("", `---`, `Canonical URL: ${SITE}/directory/${slug}/`);

  const body = lines.join("\n") + "\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Markdown-Tokens": String(Math.ceil(body.length / 4)),
    },
  });
};
