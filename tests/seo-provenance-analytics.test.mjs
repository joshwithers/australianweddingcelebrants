import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "node-html-parser";

import {
  DEFAULT_EDITORIAL_AUTHOR,
  EDITORIAL_ARTICLES,
  resolveEditorialAuthor,
} from "../src/lib/editorial.ts";
import { CORRECTIONS_URL, PUBLISHER } from "../src/lib/siteProvenance.ts";
import { getTierCredential } from "../src/lib/utils/tierCredential.ts";

const SITE = "https://australianweddingcelebrants.com.au";
const GA_ID = "G-DCYE3SSJQV";
const PROFILE_SLUG = "josh-withers-ybt9";
const DISQUALIFYING_PROFILE_COPY =
  /profile[- ]listed|profile statement|not (?:been )?independently verified|prior directory records|do(?:es)? not (?:guarantee|promise) current|do not infer current|confirm current (?:government )?authorisation/i;
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function distHtmlPath(pathname) {
  return pathname === "/"
    ? "../dist/index.html"
    : `../dist${pathname}index.html`;
}

function jsonLdFrom(html) {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => JSON.parse(match[1]));
}

test("editorial author fallback preserves explicit authors", () => {
  assert.deepEqual(resolveEditorialAuthor(), DEFAULT_EDITORIAL_AUTHOR);
  assert.deepEqual(resolveEditorialAuthor("  Taylor Example  "), {
    name: "Taylor Example",
  });
  assert.deepEqual(
    resolveEditorialAuthor({
      name: "  Casey Example  ",
      url: "https://example.com/casey",
    }),
    { name: "Casey Example", url: "https://example.com/casey" },
  );
});

test("all and only original editorial pages carry Frankie attribution", async () => {
  const sitemap = await read("../dist/sitemap-0.xml");
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]).pathname,
  );
  const authored = [];

  for (const pathname of paths) {
    const html = await read(distHtmlPath(pathname));
    const document = parse(html);
    const author = document
      .querySelector('meta[name="author"]')
      ?.getAttribute("content");
    if (author) authored.push(pathname);
  }

  assert.deepEqual(
    authored.sort(),
    EDITORIAL_ARTICLES.map((article) => article.path).sort(),
  );

  for (const article of EDITORIAL_ARTICLES) {
    const html = await read(distHtmlPath(article.path));
    assert.match(html, /<meta name="author" content="Frankie">/);
    assert.match(html, />By\s*<a[^>]+rel="author"[^>]*>Frankie<\/a>/);
    const articleSchema = jsonLdFrom(html).find(
      (item) => item["@type"] === "Article",
    );
    assert.ok(articleSchema, `${article.path} lacks Article JSON-LD`);
    assert.equal(articleSchema.author["@type"], "Person");
    assert.equal(articleSchema.author.name, "Frankie");
    assert.equal(articleSchema.publisher.name, PUBLISHER.name);

    const markdown = await read(`../dist${article.path.slice(0, -1)}.md`);
    assert.match(markdown, /^author: "Frankie"$/m);
    assert.match(markdown, /By \[Frankie\]/);
  }
});

test("RSS creator and Markdown author stay in parity", async () => {
  const rss = await read("../dist/rss.xml");
  assert.match(rss, /xmlns:dc="http:\/\/purl\.org\/dc\/elements\/1\.1\/"/);
  assert.equal(
    (rss.match(/<dc:creator>Frankie<\/dc:creator>/g) || []).length,
    EDITORIAL_ARTICLES.length,
  );
  for (const article of EDITORIAL_ARTICLES) {
    assert.ok(rss.includes(`<link>${SITE}${article.path}</link>`));
  }
});

test("public pages render the exact cookieless GA4 consent boundary", async () => {
  const source = await read("../src/layouts/Base.astro");
  const consentAt = source.indexOf('window.gtag("consent", "default"');
  const loaderAt = source.indexOf(`gtag/js?id=${GA_ID}`);
  assert.ok(
    consentAt >= 0 && loaderAt > consentAt,
    "consent defaults must precede gtag.js",
  );
  for (const key of [
    "analytics_storage",
    "ad_storage",
    "ad_user_data",
    "ad_personalization",
  ]) {
    assert.match(source, new RegExp(`${key}: "denied"`));
  }
  assert.match(source, /allow_google_signals", false/);
  assert.match(source, /allow_ad_personalization_signals", false/);
  assert.match(source, /ads_data_redaction", true/);
  assert.match(source, /send_page_view: false/);
  assert.match(
    source,
    /page_location: window\.location\.origin \+ window\.location\.pathname/,
  );
  assert.match(source, /new URL\(document\.referrer\)\.origin/);
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|document\.cookie|consent[^\n]+update/i,
  );

  const sitemap = await read("../dist/sitemap-0.xml");
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]).pathname,
  );
  for (const pathname of paths) {
    const html = await read(distHtmlPath(pathname));
    const deniedAt = html.indexOf('gtag("consent", "default"');
    const tagAt = html.indexOf(`gtag/js?id=${GA_ID}`);
    assert.ok(
      deniedAt >= 0 && tagAt > deniedAt,
      `${pathname} loads GA before denied defaults`,
    );
    assert.ok(html.includes(GA_ID), `${pathname} lacks the dedicated GA ID`);
  }

  const submitRedirect = await read("../src/pages/submit.astro");
  assert.doesNotMatch(submitRedirect, /Base|G-DCYE3SSJQV|googletagmanager/);
  assert.match(
    submitRedirect,
    /api\.australianweddingcelebrants\.com\.au\/login/,
  );
});

test("profile HTML, Markdown and JSON publish verified member records without blanket disqualifiers", async () => {
  const html = await read(`../dist/directory/${PROFILE_SLUG}/index.html`);
  assert.doesNotMatch(html, /<meta name="author"/);
  assert.match(html, /data-tier-credential="issued"/);
  assert.match(html, /Issued and human verified/);
  assert.match(html, /Australian Wedding Celebrants/);
  assert.ok(html.includes(PUBLISHER.name));
  assert.ok(html.includes("/contact/#profile-corrections"));
  assert.match(html, /no sign-in required/i);

  const schemas = jsonLdFrom(html);
  const profile = schemas.find((item) => item["@type"] === "ProfilePage");
  assert.ok(profile);
  assert.equal(profile.mainEntity["@type"], "Person");
  assert.equal(profile.publisher.name, PUBLISHER.name);
  assert.equal(
    profile.mainEntity.hasCredential["@type"],
    "EducationalOccupationalCredential",
  );
  assert.equal(profile.mainEntity.hasCredential.name, "Luminary Celebrant");
  assert.equal(
    profile.mainEntity.hasCredential.recognizedBy.name,
    PUBLISHER.name,
  );
  assert.equal(
    profile.mainEntity.hasCredential.recognizedBy.alternateName,
    "Australian Wedding Celebrants",
  );
  assert.equal("jobTitle" in profile.mainEntity, false);
  assert.equal("makesOffer" in profile.mainEntity, false);
  assert.equal(
    profile.mainEntity.description,
    "Directory profile record for Josh Withers.",
  );
  assert.equal(
    schemas.some((item) => item["@type"] === "Article"),
    false,
  );
  assert.doesNotMatch(html, DISQUALIFYING_PROFILE_COPY);
  assert.match(html, />Australia-wide travel</);

  const markdown = await read(`../dist/directory/${PROFILE_SLUG}.md`);
  assert.doesNotMatch(markdown, /^author:/m);
  assert.match(markdown, /## Directory credential/);
  assert.match(markdown, /Status: Issued and human verified/);
  assert.match(
    markdown,
    /Issuer and source: \[Australian Wedding Celebrants\]/,
  );
  assert.doesNotMatch(markdown, /evidence missing|Status: missing/i);
  assert.ok(markdown.includes(PUBLISHER.name));
  assert.ok(markdown.includes(CORRECTIONS_URL));
  assert.match(markdown, /No sign-in is required/);
  assert.doesNotMatch(markdown, DISQUALIFYING_PROFILE_COPY);
  assert.match(markdown, /\*\*Travel:\*\* Australia-wide/);

  const directory = JSON.parse(await read("../dist/directory.json"));
  assert.equal(directory.responsible_publisher.name, PUBLISHER.name);
  assert.equal(directory.corrections_url, CORRECTIONS_URL);
  assert.equal(directory.corrections_require_sign_in, false);
  const record = directory.celebrants.find(
    (item) => item.slug === PROFILE_SLUG,
  );
  assert.equal(record.tier_credential.status, "issued");
  assert.equal(record.tier_credential.issuer, "Australian Wedding Celebrants");
  assert.match(record.tier_credential.verification, /Human verified/);
  assert.equal(record.supporting_external_evidence, null);
  assert.equal(record.accepts_agent_enquiries, false);
  assert.deepEqual(record.description_provenance, {
    publisher: PUBLISHER.name,
    publisher_url: PUBLISHER.url,
    corrections_url: CORRECTIONS_URL,
  });
  assert.equal("profile_statement_notice" in directory, false);
  assert.equal("usage_notice" in directory, false);
});

test("every rendered profile and profile companion is free of distancing labels", async () => {
  const sitemap = await read("../dist/sitemap-0.xml");
  const profilePaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname)
    .filter((pathname) => /^\/directory\/[^/]+\/$/.test(pathname));

  assert.ok(profilePaths.length > 0);
  for (const pathname of profilePaths) {
    const [html, markdown] = await Promise.all([
      read(distHtmlPath(pathname)),
      read(`../dist${pathname.slice(0, -1)}.md`),
    ]);
    assert.doesNotMatch(html, DISQUALIFYING_PROFILE_COPY, pathname);
    assert.doesNotMatch(markdown, DISQUALIFYING_PROFILE_COPY, `${pathname}.md`);
  }
});

test("LLM surfaces and privacy notice publish provenance and measurement limits", async () => {
  const [llms, full, privacy] = await Promise.all([
    read("../dist/llms.txt"),
    read("../dist/llms-full.txt"),
    read("../dist/privacy/index.html"),
  ]);
  for (const text of [llms, full]) {
    assert.ok(text.includes(PUBLISHER.name));
    assert.ok(text.includes(CORRECTIONS_URL));
    assert.match(text, /(?:no sign-in|without signing in)/i);
    assert.match(text, /last.checked/i);
    assert.doesNotMatch(text, DISQUALIFYING_PROFILE_COPY);
  }
  assert.match(privacy, /G-DCYE3SSJQV/);
  assert.match(privacy, /cookieless page-measurement requests/);
  assert.match(
    privacy,
    /does not make a promise of anonymity or guaranteed non-identifiability/,
  );
  assert.match(privacy, /query string/);
  assert.match(privacy, /referring page is reduced to its origin/);
  assert.doesNotMatch(privacy, /No tracking or analytics/);
});

test("agent enquiries require explicit stored opt-in", async () => {
  const [directory, article] = await Promise.all([
    read("../dist/directory.json").then(JSON.parse),
    read("../dist/ai/index.html"),
  ]);
  assert.ok(
    directory.celebrants.every(
      (item) => item.accepts_agent_enquiries === false,
    ),
  );
  assert.match(
    article,
    /Agent-relayed enquiries require an explicit profile opt-in/,
  );
  assert.match(article, /missing setting is treated as not opted in/);
  assert.doesNotMatch(article, /opt in by default/);
});

test("publisher credentials remain issued while optional external evidence currency is deterministic", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const publisherOnly = getTierCredential({}, now);
  assert.equal(publisherOnly.status, "issued");
  assert.equal(publisherOnly.issuer, "Australian Wedding Celebrants");
  assert.equal(publisherOnly.supportingEvidence, null);
  assert.equal(
    getTierCredential(
      {
        tier_evidence_source: "Official register and submitted documents",
        tier_evidence_last_checked: "2026-08-30",
      },
      now,
    ).supportingEvidence.status,
    "current",
  );
  assert.equal(
    getTierCredential(
      {
        tier_evidence_source: "Official register and submitted documents",
        tier_evidence_last_checked: "2025-08-28",
      },
      now,
    ).supportingEvidence.status,
    "stale",
  );
});
