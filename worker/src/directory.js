// Shared data access for MCP + A2A handlers. Fetches /directory.json from
// the site (Cloudflare edge-cached) and keeps a 1-minute in-isolate cache.

const CACHE_TTL_MS = 60 * 1000;

let listCache = null;
let listCacheAt = 0;

export async function loadListings(env) {
  if (listCache && Date.now() - listCacheAt < CACHE_TTL_MS) return listCache;

  const siteUrl = env.SITE_URL || "https://australianweddingcelebrants.com.au";
  const res = await fetch(`${siteUrl}/directory.json`, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Failed to load directory.json: ${res.status}`);
  const data = await res.json();

  listCache = (data.celebrants || []).map((c) => ({
    slug: c.slug,
    name: c.name,
    tier: c.tier || "registered",
    locations: c.locations || [],
    categories: c.categories || [],
    description: c.description || "",
    australia_wide: !!c.australia_wide,
    international: !!c.international,
    accepts_agent_enquiries: c.accepts_agent_enquiries === true, // explicit opt-in only
    website: c.website || null,
    email: c.email || null,
    phone: c.phone || null,
    address: c.address || null,
    url: c.url,
    markdown_url: c.markdown_url,
  }));
  listCacheAt = Date.now();
  return listCache;
}

export async function loadProfile(env, slug) {
  const siteUrl = env.SITE_URL || "https://australianweddingcelebrants.com.au";
  const res = await fetch(`${siteUrl}/directory/${encodeURIComponent(slug)}.md`, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) return null;
  return await res.text();
}

export function slugifyLocation(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const TIER_ORDER = { luminary: 0, endorsed: 1, registered: 2 };

export function sortByTier(a, b) {
  return (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
}
