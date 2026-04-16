#!/usr/bin/env node
/**
 * Downloads every external (http/https) image referenced from
 * src/content/directory/*.{md,mdx} (image, logo, gallery), saves it to
 * src/assets/directory/, and rewrites the frontmatter to point at the
 * local asset path.
 *
 * After offlining, those images go through Astro's <Image> pipeline —
 * auto-optimised to webp, served at multiple widths, with correct
 * intrinsic dimensions (no PageSpeed aspect-ratio warnings, no CLS,
 * no dependency on the third-party origin staying up).
 *
 * Usage:
 *   node scripts/offline-external-images.mjs --dry-run    # preview only
 *   node scripts/offline-external-images.mjs              # do it
 *   node scripts/offline-external-images.mjs --force      # re-download even if local copy exists
 *   node scripts/offline-external-images.mjs --only celebrant-lady-love
 *
 * Naming: <celebrant-slug>-image.<ext>, <celebrant-slug>-logo.<ext>,
 * <celebrant-slug>-gallery-1.<ext>, etc. Extension comes from the
 * server's Content-Type header (falls back to the URL extension, then
 * to .jpg).
 *
 * Source markdown files are mutated in place. Existing local-asset
 * paths (../../assets/...) are left untouched.
 */

import matter from "gray-matter";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIRECTORY_DIR = join(ROOT, "src/content/directory");
const ASSETS_DIR = join(ROOT, "src/assets/directory");
const ASSETS_RELATIVE = "../../assets/directory";

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/heic": ".heic",
};

function isExternal(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function extFromContentType(ct) {
  if (!ct) return null;
  const base = ct.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || null;
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const e = extname(u.pathname).toLowerCase();
    if (/^\.(jpe?g|png|webp|gif|svg|avif|heic)$/.test(e)) {
      return e === ".jpeg" ? ".jpg" : e;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function findExistingAsset(nameBase) {
  for (const f of readdirSync(ASSETS_DIR)) {
    if (basename(f, extname(f)) === nameBase) return f;
  }
  return null;
}

async function downloadImage(url, destBase) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AustralianWeddingCelebrantsBot/1.0; +https://australianweddingcelebrants.com.au)",
      Accept: "image/*,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const ext = extFromContentType(ct) || extFromUrl(url) || ".jpg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("empty response body");
  const finalPath = destBase + ext;
  writeFileSync(finalPath, buf);
  return { filename: basename(finalPath), bytes: buf.byteLength };
}

function parseArgs(argv) {
  const args = { force: false, dryRun: false, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only.push(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });

  const files = readdirSync(DIRECTORY_DIR).filter((f) =>
    /\.(md|mdx)$/.test(f),
  );
  let totalDownloaded = 0;
  let totalKept = 0;
  let totalFailed = 0;
  let filesUpdated = 0;
  const failedUrls = [];

  for (const file of files) {
    const slug = basename(file, extname(file));
    if (args.only.length > 0 && !args.only.includes(slug)) continue;

    const filePath = join(DIRECTORY_DIR, file);
    const raw = readFileSync(filePath, "utf8");
    let parsed;
    try {
      parsed = matter(raw);
    } catch (err) {
      console.warn(`! ${file}: skipping (frontmatter parse failed: ${err.message})`);
      continue;
    }
    const { data } = parsed;

    const targets = [];
    if (isExternal(data.image)) {
      targets.push({ url: data.image, nameBase: `${slug}-image` });
    }
    if (isExternal(data.logo)) {
      targets.push({ url: data.logo, nameBase: `${slug}-logo` });
    }
    if (Array.isArray(data.gallery)) {
      data.gallery.forEach((g, i) => {
        if (isExternal(g)) {
          targets.push({ url: g, nameBase: `${slug}-gallery-${i + 1}` });
        }
      });
    }

    if (targets.length === 0) continue;

    console.log(`\n${file}`);
    for (const t of targets) {
      const existing = !args.force ? findExistingAsset(t.nameBase) : null;
      if (existing) {
        console.log(`  = keep ${existing}`);
        t.localFilename = existing;
        totalKept += 1;
        continue;
      }
      if (args.dryRun) {
        console.log(`  ? would download ${t.url} → ${t.nameBase}.<ext>`);
        continue;
      }
      try {
        const r = await downloadImage(t.url, join(ASSETS_DIR, t.nameBase));
        console.log(
          `  + ${t.url} → ${r.filename} (${(r.bytes / 1024).toFixed(1)} KB)`,
        );
        t.localFilename = r.filename;
        totalDownloaded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ! ${t.url} failed: ${msg}`);
        failedUrls.push({ file, url: t.url, error: msg });
        totalFailed += 1;
      }
    }

    if (args.dryRun) continue;

    // Surgical text replacement preserves YAML formatting (quote style,
    // comments, indentation) better than a gray-matter stringify roundtrip.
    let updated = raw;
    for (const t of targets) {
      if (!t.localFilename) continue;
      const localPath = `${ASSETS_RELATIVE}/${t.localFilename}`;
      updated = updated.split(t.url).join(localPath);
    }
    if (updated !== raw) {
      writeFileSync(filePath, updated, "utf8");
      filesUpdated += 1;
      console.log(`  ✓ rewrote frontmatter`);
    }
  }

  console.log(
    `\nDone. ${totalDownloaded} downloaded, ${totalKept} already-local kept, ${totalFailed} failed. ${filesUpdated} markdown file(s) rewritten.`,
  );
  if (failedUrls.length > 0) {
    console.log(`\nFailed URLs (frontmatter NOT rewritten for these):`);
    for (const f of failedUrls) console.log(`  ${f.file}: ${f.url} — ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
