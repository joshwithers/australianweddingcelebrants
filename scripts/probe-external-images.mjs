#!/usr/bin/env node
/**
 * Probes every external (http/https) image URL referenced from
 * src/content/directory/*.{md,mdx} and writes the dimensions to
 * src/data/external-image-dimensions.json.
 *
 * DirectoryItem.astro reads that JSON to emit correct width/height
 * attributes on <img> tags for remote images, so the browser reserves
 * the correct aspect-ratio space (no CLS, no PageSpeed warning about
 * "Displays images with incorrect aspect ratio").
 *
 * Usage:
 *   node scripts/probe-external-images.mjs
 *
 * Run this any time a celebrant's external image URL changes. Existing
 * entries are preserved if a fresh probe fails (so a temporarily down
 * server doesn't wipe the cache).
 */

import probe from "probe-image-size";
import matter from "gray-matter";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIRECTORY_DIR = join(ROOT, "src/content/directory");
const OUTPUT_PATH = join(ROOT, "src/data/external-image-dimensions.json");
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;

function isExternal(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function loadExternalImageUrls() {
  const urls = new Set();
  for (const f of readdirSync(DIRECTORY_DIR)) {
    if (!/\.(md|mdx)$/.test(f)) continue;
    try {
      const raw = readFileSync(join(DIRECTORY_DIR, f), "utf8");
      const { data } = matter(raw);
      if (data.draft) continue;
      if (isExternal(data.image)) urls.add(data.image);
      if (isExternal(data.logo)) urls.add(data.logo);
      if (Array.isArray(data.gallery)) {
        for (const g of data.gallery) if (isExternal(g)) urls.add(g);
      }
    } catch (err) {
      console.warn(`! Skipping ${f}: ${err.message}`);
    }
  }
  return [...urls];
}

function loadExisting() {
  if (!existsSync(OUTPUT_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function probeOne(url) {
  const result = await probe(url, {
    timeout: TIMEOUT_MS,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AustralianWeddingCelebrantsBot/1.0; +https://australianweddingcelebrants.com.au)",
    },
  });
  return { width: result.width, height: result.height };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          results[i] = { ok: true, value: await worker(items[i]) };
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
  const urls = loadExternalImageUrls();
  console.log(`Found ${urls.length} external image URLs.`);

  const existing = loadExisting();
  const cache = { ...existing };

  const results = await runPool(urls, CONCURRENCY, async (url) => {
    const dims = await probeOne(url);
    return { url, dims };
  });

  let probed = 0;
  let failed = 0;
  let unchanged = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const r = results[i];
    if (r.ok) {
      const prev = cache[url];
      if (
        prev &&
        prev.width === r.value.dims.width &&
        prev.height === r.value.dims.height
      ) {
        unchanged += 1;
      } else {
        cache[url] = r.value.dims;
        probed += 1;
        console.log(
          `+ ${url} → ${r.value.dims.width}×${r.value.dims.height}`,
        );
      }
    } else {
      failed += 1;
      const msg = r.error instanceof Error ? r.error.message : String(r.error);
      if (cache[url]) {
        console.warn(
          `! ${url} probe failed (${msg}) — keeping cached ${cache[url].width}×${cache[url].height}`,
        );
      } else {
        console.warn(`! ${url} probe failed (${msg}) — no cached fallback`);
      }
    }
  }

  // Sort keys for stable diffs
  const sorted = Object.fromEntries(
    Object.keys(cache)
      .sort()
      .map((k) => [k, cache[k]]),
  );
  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  console.log(
    `\nDone. Probed ${probed} new/changed, ${unchanged} unchanged, ${failed} failed.`,
  );
  console.log(`Wrote ${Object.keys(sorted).length} entries to ${OUTPUT_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
