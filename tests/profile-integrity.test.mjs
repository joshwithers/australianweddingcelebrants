import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import matter from "gray-matter";

const SITE = "https://australianweddingcelebrants.com.au";
const CANONICAL_SLUG = "josh-withers-ybt9";
const CANONICAL_URL = `${SITE}/directory/${CANONICAL_SLUG}/`;
const PROFILE_DIR = new URL("../src/content/directory/", import.meta.url);

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Josh has one canonical source profile with public contact details", async () => {
  const files = (await readdir(PROFILE_DIR)).filter((file) =>
    file.endsWith(".md"),
  );
  const profiles = await Promise.all(
    files.map(async (file) => ({
      file,
      data: matter(await readFile(new URL(file, PROFILE_DIR), "utf8")).data,
    })),
  );
  const joshProfiles = profiles.filter(
    ({ data }) => data.title?.toLowerCase() === "josh withers",
  );

  assert.equal(joshProfiles.length, 1);
  assert.equal(joshProfiles[0].file, `${CANONICAL_SLUG}.md`);
  assert.equal(joshProfiles[0].data.email, "josh@withers.co");
  assert.equal(joshProfiles[0].data.phone, "+61 485 866 606");

  const duplicateTitles = Object.entries(
    Object.groupBy(profiles, ({ data }) => data.title?.trim().toLowerCase()),
  ).filter(([title, entries]) => title && entries.length > 1);
  assert.deepEqual(duplicateTitles, []);
});

test("legacy Josh URLs redirect to the canonical profile", async () => {
  const redirects = await read("../public/_redirects");
  for (const alias of [
    "/directory/josh-withers",
    "/directory/josh-withers/",
    "/directory/married-by-josh",
    "/directory/married-by-josh/",
    "/josh-withers",
    "/josh-withers/",
    "/listing/josh-withers/",
  ]) {
    assert.match(
      redirects,
      new RegExp(
        `^${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+/directory/${CANONICAL_SLUG}/\\s+301$`,
        "m",
      ),
    );
  }
});

test("cross-promotion is optional and cannot affect directory status", async () => {
  const tools = await read("../src/pages/tools-for-celebrants.astro");
  for (const url of [
    "https://wedding.computer/",
    "https://theinternet.com.au/",
    "https://unpopular.au/",
    "https://noimeasy.au/",
    "https://thesmh.com.au/",
  ]) {
    assert.ok(tools.includes(url), `Missing resource: ${url}`);
  }
  assert.match(tools, /has no effect\s+on directory inclusion/i);
  assert.match(tools, /Rankings and tiers cannot be bought/i);
});

test("source contains no present-tense Celebrant Institute affiliation", async () => {
  const sourceFiles = [
    "../src/content/directory/josh-withers-ybt9.md",
    "../src/pages/about.astro",
    "../src/pages/ai.astro",
    "../src/pages/tools-for-celebrants.astro",
  ];
  const source = (await Promise.all(sourceFiles.map(read))).join("\n");

  assert.doesNotMatch(
    source,
    /Josh(?:ua)? Withers[^.\n]{0,120}(?:owns|runs|works (?:at|for)|is (?:an? )?(?:owner|employee|director|founder|co-founder) of)[^.\n]{0,120}Celebrant Institute/i,
  );
});

test("built outputs expose one canonical Josh profile with valid Person schema", async () => {
  const directory = JSON.parse(await read("../dist/directory.json"));
  const joshRecords = directory.celebrants.filter(
    ({ name, slug }) =>
      name.toLowerCase() === "josh withers" || slug.includes("josh"),
  );
  assert.equal(joshRecords.length, 1);
  assert.equal(joshRecords[0].slug, CANONICAL_SLUG);
  assert.equal(joshRecords[0].email, "josh@withers.co");
  assert.equal(joshRecords[0].phone, "+61 485 866 606");
  assert.equal(
    directory.directory_policy.tiers_and_position_cannot_be_bought,
    true,
  );
  assert.equal(
    directory.directory_policy.other_services_do_not_affect_directory_status,
    true,
  );

  const html = await read(`../dist/directory/${CANONICAL_SLUG}/index.html`);
  assert.match(
    html,
    new RegExp(
      `<link rel="canonical" href="${CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );

  const jsonLd = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => JSON.parse(match[1]));
  const profile = jsonLd.find((entry) => entry["@type"] === "ProfilePage");
  assert.ok(profile);
  assert.equal(profile.mainEntity["@type"], "Person");
  assert.equal(profile.mainEntity["@id"], `${CANONICAL_URL}#person`);
  assert.equal(profile.mainEntity.telephone, "+61485866606");
  assert.match(profile.mainEntity.image, /^https:\/\//);
  assert.equal(
    profile.mainEntity.homeLocation.address.addressLocality,
    "Hobart",
  );
  assert.equal(
    profile.mainEntity.homeLocation.address.addressRegion,
    "Tasmania",
  );
  assert.equal(profile.mainEntity.homeLocation.address.addressCountry, "AU");
  assert.equal(
    "streetAddress" in profile.mainEntity.homeLocation.address,
    false,
  );
});

test("built indexes and sitemap contain one Josh listing each", async () => {
  for (const path of [
    "../dist/directory/index.html",
    "../dist/search/index.html",
  ]) {
    const html = await read(path);
    const links = html.match(
      new RegExp(`href="/directory/${CANONICAL_SLUG}/"`, "g"),
    );
    assert.equal(links?.length, 1, `${path} contains a duplicate Josh card`);
  }

  const sitemap = await read("../dist/sitemap-0.xml");
  assert.equal(
    sitemap.match(
      new RegExp(CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    )?.length,
    1,
  );
  assert.doesNotMatch(
    sitemap,
    /\/(?:directory\/)?(?:married-by-josh|josh-withers)\/</,
  );
});
