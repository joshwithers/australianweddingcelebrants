# Scripts

One-off Node scripts for content generation. Not part of the build — run them manually when you want to regenerate something.

---

## `probe-external-images.mjs`

Probes every external (`http://` / `https://`) image URL referenced from celebrant frontmatter (`image`, `logo`, `gallery`) and writes the dimensions to `src/data/external-image-dimensions.json`.

**Why:** `DirectoryItem.astro` reads that JSON to emit correct `width`/`height` attributes on `<img>` tags for remote images. Without this, the browser either reserves wrong-aspect-ratio space (PageSpeed flags "Displays images with incorrect aspect ratio") or no space at all (causes CLS). Local images go through Astro's `<Image>` and don't need this — their dimensions are read from disk at build time.

**Usage:**

```sh
npm run probe:external-images
```

Or directly: `node scripts/probe-external-images.mjs`. No API key required.

**Behaviour:**

- Runs probes in parallel (concurrency 6, 8s timeout each).
- Existing entries are preserved if a fresh probe fails (so a temporarily-down server doesn't wipe the cache).
- Output is sorted by URL for stable diffs.

**When to run:** any time a celebrant's external image URL changes, or after adding a new celebrant with an external image. Migrating an external URL to a local asset (`../../assets/directory/...`) is preferred where possible — local images are optimised by Astro automatically.

---

## `generate-location-blurbs.mjs`

Generates SEO body copy for `/directory/location/<slug>/` pages. Each blurb appears above the celebrant grid and gives search engines / LLMs substantive, region-specific content to index for queries like "wedding celebrants in Perth".

### Output location

```
src/content/location-blurbs/<slug>.md
```

For example, `src/content/location-blurbs/perth.md`. Each file is a plain markdown file with a frontmatter block and a 2–3 paragraph body. **Edit any file directly to change the blurb on that page** — the script will not overwrite existing files unless you pass `--force`.

The slug matches the URL slug computed by `github-slugger` from the location name in the celebrant frontmatter (`Perth` → `perth`, `Gold Coast Hinterland` → `gold-coast-hinterland`).

### How it gets rendered

`src/pages/directory/location/[location].astro` looks up the matching entry from the `locationBlurbs` content collection (defined in `src/content.config.ts`) and renders it above the masonry grid. If no blurb file exists for a location, the page just renders without one — nothing breaks.

### Setup

The script needs the Anthropic SDK and gray-matter, both already in `devDependencies`. If `node_modules` is fresh, run:

```sh
npm install
```

Set your Anthropic API key in the environment:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

### Usage

```sh
# Generate blurbs for every location that doesn't already have one.
npm run generate:location-blurbs

# Or invoke directly:
node scripts/generate-location-blurbs.mjs

# Preview what would be generated, without calling the API:
node scripts/generate-location-blurbs.mjs --dry-run

# Regenerate a single location (slug must match the URL form):
node scripts/generate-location-blurbs.mjs --only perth

# Overwrite all existing blurbs (destroys manual edits — be careful):
node scripts/generate-location-blurbs.mjs --force

# Tune parallel API calls (default 4):
node scripts/generate-location-blurbs.mjs --concurrency 8
```

Flags can be combined: `--force --only perth` regenerates one slug even if its file exists.

### What the script does

1. Reads every celebrant under `src/content/directory/*.{md,mdx}` via `gray-matter`.
2. Collects unique locations from each celebrant's `location[]` array.
3. For each location:
   - Skips if `src/content/location-blurbs/<slug>.md` already exists (unless `--force`).
   - Calls Claude Opus 4.6 (`claude-opus-4-6`) with adaptive thinking, low effort, ~1024 max tokens.
   - Writes the response to the output file with frontmatter (`location`, `slug`, `generated_at`, `model`).

API calls run in parallel with a small worker pool (default concurrency 4).

### The prompt

The system prompt lives inline in the script (search for `SYSTEM_PROMPT`) and constrains the model to:

- 160–230 words, plain prose, 2–3 paragraphs.
- Address couples planning a wedding ("you" / "your").
- Include 1–3 genuinely true, locally-specific observations (landscape, climate, wedding settings, seasons).
- **Do not invent** venue names, business names, statistics, awards, prices, dates, or quotes.
- **Do not** mention specific celebrants by name or count them — the grid below speaks for itself, so the blurb stays valid as celebrants come and go.
- No headings, lists, links, or frontmatter in the output. Markdown only — plain paragraphs.

The user-message portion only includes the location name and slug. To change tone/length/structure, edit `SYSTEM_PROMPT` and re-run with `--force`.

### Editing a blurb manually

Just open the file, edit the markdown body, save. The frontmatter doesn't have to be kept in sync — `generated_at` and `model` are informational. Schema (in `src/content.config.ts` → `locationBlurbsCollection`) only requires `location`. No build step needed; Astro's content layer picks the change up on next dev/build.

### Adding a new location

Add the location string to a celebrant's `location[]` array in `src/content/directory/<celebrant>.md`. Next time you run the script, that location will show up in the dry-run list and a blurb will be generated for it. Or run the script with `--only <new-slug>` to grab just that one.

### Cost

A single 200-word blurb costs roughly 500 input + 400 output tokens at Opus 4.6 pricing (~$0.013 per blurb). 60 locations ≈ $0.80 total. The script doesn't cache (the system prompt is too short to qualify for Opus 4.6's 4096-token minimum cacheable prefix).

### Troubleshooting

- **`ANTHROPIC_API_KEY is not set. Aborting.`** — export the env var as shown above.
- **Blurb didn't update after editing the script's prompt** — existing files are skipped. Use `--force` (or `--only <slug> --force` for one).
- **A blurb appears for an unwanted location** (e.g. `interstate`) — delete the file at `src/content/location-blurbs/<slug>.md` and fix the source celebrant's `location[]` array so the bogus location isn't re-discovered on the next run.
- **A celebrant has duplicate YAML keys** — the script uses `gray-matter` (lenient parser), so it'll skip the file with a warning. Fix the duplicates in the source markdown.
