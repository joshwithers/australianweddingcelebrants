import { PUBLISHER, SITE_URL } from "./siteProvenance.ts";

export type EditorialAuthor = {
  name: string;
  url?: string;
  id?: string;
};

export type EditorialArticle = {
  path: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  author?: EditorialAuthor | string;
};

export const DEFAULT_EDITORIAL_AUTHOR: EditorialAuthor = {
  name: "Frankie",
  url: `${SITE_URL}/about/#frankie`,
  id: `${SITE_URL}/about/#frankie`,
};

export function resolveEditorialAuthor(
  author?: EditorialAuthor | string | null,
): EditorialAuthor {
  if (typeof author === "string" && author.trim()) {
    return { name: author.trim() };
  }
  if (author && typeof author === "object" && author.name.trim()) {
    return { ...author, name: author.name.trim() };
  }
  return DEFAULT_EDITORIAL_AUTHOR;
}

export const EDITORIAL_ARTICLES = [
  {
    path: "/ai/",
    title: "How this site works with AI, search engines, and bots",
    description:
      "A plain-English walkthrough of the machine-readable surfaces this directory publishes for search engines, LLMs, and autonomous agents.",
    datePublished: "2026-04-23",
    dateModified: "2026-08-30",
  },
  {
    path: "/connect/",
    title: "Connect this directory to your AI assistant",
    description:
      "How to connect the Australian Wedding Celebrants MCP server to an AI assistant or compatible editor.",
    datePublished: "2026-05-17",
    dateModified: "2026-08-30",
  },
  {
    path: "/tiers/",
    title: "Professional Recognition for Wedding Celebrants",
    description:
      "How the Registered, Endorsed, and Luminary directory standards work, what evidence they require, and how to interpret them.",
    datePublished: "2026-04-07",
    dateModified: "2026-08-30",
  },
  {
    path: "/tools-for-celebrants/",
    title: "Optional tools for celebrants",
    description:
      "A curated guide to optional workflow, website, SEO, NOIM, and business-reading resources for Australian marriage celebrants.",
    datePublished: "2026-07-30",
    dateModified: "2026-08-30",
  },
] as const satisfies readonly EditorialArticle[];

export function getEditorialArticle(path: string): EditorialArticle {
  const article = EDITORIAL_ARTICLES.find((item) => item.path === path);
  if (!article) throw new Error(`Editorial article is not registered: ${path}`);
  return article;
}

export const ARTICLE_PUBLISHER = PUBLISHER;
