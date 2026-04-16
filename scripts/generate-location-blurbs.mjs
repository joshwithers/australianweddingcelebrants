#!/usr/bin/env node
/**
 * Generates SEO blurbs for /directory/location/<slug>/ pages.
 *
 * Reads every celebrant under src/content/directory/, collects unique
 * locations, and writes one markdown file per location to
 * src/content/location-blurbs/<slug>.md.
 *
 * Existing files are preserved — manual edits survive re-runs.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-location-blurbs.mjs
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-location-blurbs.mjs --force
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-location-blurbs.mjs --only perth
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-location-blurbs.mjs --dry-run
 *
 * Flags:
 *   --force          Overwrite existing blurb files.
 *   --only <slug>    Only (re)generate the named slug. Repeatable.
 *   --dry-run        Print what would be generated without calling the API.
 *   --concurrency N  Parallel API calls. Default 4.
 */

import Anthropic from "@anthropic-ai/sdk";
import matter from "gray-matter";
import { slug as ghSlug } from "github-slugger";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIRECTORY_DIR = join(ROOT, "src/content/directory");
const OUTPUT_DIR = join(ROOT, "src/content/location-blurbs");
const MODEL = "claude-opus-4-6";

function parseArgs(argv) {
  const args = { force: false, dryRun: false, only: [], concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only.push(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]) || 4;
  }
  return args;
}

function humanize(s) {
  return s
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function loadDirectoryEntries() {
  const files = readdirSync(DIRECTORY_DIR).filter((f) =>
    /\.(md|mdx)$/.test(f),
  );
  const entries = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(DIRECTORY_DIR, f), "utf8");
      const { data } = matter(raw);
      if (data.draft) continue;
      entries.push(data);
    } catch (err) {
      console.warn(`! Skipping ${f}: ${err.message}`);
    }
  }
  return entries;
}

function collectLocations(entries) {
  const map = new Map(); // slug → { name, localCount, australiaWideCount, tierCounts }
  for (const e of entries) {
    const isAW = e.australia_wide === true;
    const tier = e.tier || "registered";
    const locations = Array.isArray(e.location) ? e.location : [];
    for (const loc of locations) {
      if (!loc || typeof loc !== "string") continue;
      const slug = ghSlug(loc);
      if (!slug) continue;
      if (!map.has(slug)) {
        map.set(slug, {
          slug,
          name: humanize(loc),
          localCount: 0,
          australiaWideCount: 0,
          tierCounts: { luminary: 0, endorsed: 0, registered: 0 },
        });
      }
      const bucket = map.get(slug);
      bucket.localCount += 1;
      bucket.tierCounts[tier] = (bucket.tierCounts[tier] || 0) + 1;
      if (isAW) bucket.australiaWideCount += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

const SYSTEM_PROMPT = `You are an SEO copywriter for Australian Wedding Celebrants — a directory of authorised marriage celebrants across Australia.

For each Australian location provided, write a blurb that appears above a directory grid headed "The Top N Wedding Celebrants in {Location}".

Goals
- Help the page rank for queries like "wedding celebrants in {Location}" and "{Location} wedding celebrant".
- Give search engines and LLMs substantive, location-specific copy to index.
- Reassure couples planning a wedding in this region that they're in the right place.

Hard requirements
- 160–230 words, plain prose, two or three short paragraphs.
- Address couples planning a wedding (use "you" / "your").
- Include 1–3 genuinely true, locally-specific observations: landscape, climate, popular wedding settings (beach, garden, vineyard, country, harbour, urban, etc.), seasonal considerations, or wedding character.
- Naturally include the phrase "wedding celebrant" and the location name. Avoid keyword-stuffing.
- Reference that the celebrants listed below are available to marry couples in this area.
- Do NOT invent any of: specific venue names, business names, suburbs you're unsure about, statistics, awards, prices, dates, years of experience, or quotes. If unsure, stay general.
- Do NOT use headings, bullet lists, code fences, frontmatter, or links. Markdown only — plain paragraphs separated by blank lines.
- Do NOT mention specific celebrants or count them — the grid below speaks for itself.
- Do NOT start with "Welcome" or with the location name in title case as a header.

Output the blurb body only. No preamble, no commentary, no surrounding quotes.`;

function buildUserPrompt(loc) {
  return [
    `Location name: ${loc.name}`,
    `Slug used in URL: ${loc.slug}`,
    ``,
    `Write the blurb.`,
  ].join("\n");
}

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
}

function blurbPath(slug) {
  return join(OUTPUT_DIR, `${slug}.md`);
}

function escapeYaml(s) {
  return String(s).replace(/"/g, '\\"');
}

function writeBlurb(loc, body) {
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    "---",
    `location: "${escapeYaml(loc.name)}"`,
    `slug: "${escapeYaml(loc.slug)}"`,
    `generated_at: "${today}"`,
    `model: "${MODEL}"`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
  writeFileSync(blurbPath(loc.slug), frontmatter, "utf8");
}

async function generateOne(client, loc) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    messages: [{ role: "user", content: buildUserPrompt(loc) }],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty response from model");
  return text;
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          results[i] = { ok: true, value: await worker(items[i], i) };
        } catch (err) {
          results[i] = { ok: false, error: err };
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Aborting.");
    process.exit(1);
  }

  ensureOutputDir();

  const entries = loadDirectoryEntries();
  console.log(`Loaded ${entries.length} celebrant entries.`);

  let locations = collectLocations(entries);
  console.log(`Found ${locations.length} unique locations.`);

  if (args.only.length > 0) {
    const wanted = new Set(args.only.map((s) => ghSlug(s)));
    locations = locations.filter((l) => wanted.has(l.slug));
    console.log(`Filtered to ${locations.length} via --only.`);
  }

  const todo = locations.filter((l) => {
    const exists = existsSync(blurbPath(l.slug));
    if (exists && !args.force) {
      console.log(`= skip ${l.slug} (exists; use --force to overwrite)`);
      return false;
    }
    return true;
  });

  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(
    `\nWill ${args.dryRun ? "(dry-run) describe" : "generate"} ${todo.length} blurb${todo.length === 1 ? "" : "s"}:`,
  );
  for (const l of todo) {
    console.log(
      `  - ${l.slug.padEnd(28)} ${l.name} (${l.localCount} celebrants, ${l.australiaWideCount} also AU-wide)`,
    );
  }

  if (args.dryRun) {
    console.log("\nDry run — no API calls made.");
    return;
  }

  const client = new Anthropic();
  console.log(`\nGenerating with ${MODEL}, concurrency=${args.concurrency}...`);

  const results = await runPool(todo, args.concurrency, async (loc) => {
    const start = Date.now();
    const body = await generateOne(client, loc);
    writeBlurb(loc, body);
    const ms = Date.now() - start;
    console.log(`+ wrote ${loc.slug}.md (${body.length} chars, ${ms}ms)`);
    return { slug: loc.slug, chars: body.length };
  });

  const failures = results
    .map((r, i) => ({ r, loc: todo[i] }))
    .filter(({ r }) => !r.ok);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const { r, loc } of failures) {
      const msg = r.error instanceof Error ? r.error.message : String(r.error);
      console.error(`  ! ${loc.slug}: ${msg}`);
    }
    process.exit(1);
  }
  console.log(`\nDone. ${results.length} blurb(s) written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
