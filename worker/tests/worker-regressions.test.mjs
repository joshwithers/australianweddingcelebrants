import assert from "node:assert/strict";
import test from "node:test";

import { handleA2A, validateEnquiry } from "../src/a2a.js";
import {
  buildFrontmatter,
  handleSubmit,
  parseFrontmatter,
  processDelayedNotifications,
  processWeeklyEnquiryDigest,
} from "../src/index.js";

function createKv(entries = {}) {
  const values = new Map(Object.entries(entries));
  const puts = [];
  const deletes = [];
  return {
    values,
    puts,
    deletes,
    async get(key, options) {
      const value = values.get(key) ?? null;
      return options?.type === "json" && value ? JSON.parse(value) : value;
    },
    async put(key, value, options) {
      values.set(key, value);
      puts.push({ key, value, options });
    },
    async delete(key) {
      values.delete(key);
      deletes.push(key);
    },
    async list({ prefix }) {
      return {
        keys: [...values.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
      };
    },
  };
}

test("invalid listing forms do not lock out an immediate correction", async () => {
  const KV = createKv();
  const response = await handleSubmit(
    new Request("https://api.example.test/submit", {
      method: "POST",
      body: new FormData(),
    }),
    { KV, SITE_URL: "https://example.test" },
    { email: "celebrant@example.test" },
    { waitUntil() {} },
  );

  assert.equal(response.status, 400);
  assert.equal(
    KV.puts.some(({ key }) => key === "submit-lock:celebrant@example.test"),
    false,
  );
});

test("listing frontmatter safely round-trips input and preserves premium fields", () => {
  const existing = {
    title: "Old title",
    awards: [{ title: "Community choice", year: 2025 }],
    gallery: ["../../assets/directory/one.webp"],
    testimonials: [{ quote: "Brilliant", name: "A couple" }],
    background_color: "#fafafa",
    tier_evidence_reviewed_at: "2026-08-01",
  };
  const frontmatter = buildFrontmatter(
    {
      title: "New title",
      brand_name: "",
      description: "Updated",
      email: "new@example.test",
      location: ["Sydney\nfeatured: true"],
      category: ["Civil Celebrant"],
      accepts_agent_enquiries: false,
      social: {},
    },
    "luminary",
    false,
    existing,
  );
  const parsed = parseFrontmatter(`${frontmatter}\nBiography`);

  assert.equal(parsed.title, "New title");
  assert.deepEqual(parsed.location, ["Sydney\nfeatured: true"]);
  assert.equal(parsed.featured, undefined);
  assert.deepEqual(parsed.awards, existing.awards);
  assert.deepEqual(parsed.gallery, existing.gallery);
  assert.deepEqual(parsed.testimonials, existing.testimonials);
  assert.equal(parsed.background_color, "#fafafa");
  assert.equal(parsed.tier_evidence_reviewed_at, "2026-08-01");
});

test("delayed listing notifications remain queued after a provider failure", async (t) => {
  const KV = createKv({
    "notify:abc": JSON.stringify({
      submission_id: "abc",
      approved_at: 0,
      slug: "example",
    }),
    "submission:abc": JSON.stringify({
      email: "person@example.test",
      title: "Example",
    }),
  });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async () =>
    new Response("provider failure", { status: 503 });
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  });

  await processDelayedNotifications({
    KV,
    RESEND_API_KEY: "test",
    FROM_EMAIL: "from@example.test",
    SITE_URL: "https://example.test",
  });
  assert.equal(KV.values.has("notify:abc"), true);
  assert.deepEqual(KV.deletes, []);
});

test("weekly digest records its guard only after Resend accepts the email", async (t) => {
  const now = new Date("2026-09-07T09:00:00.000Z");
  const KV = createKv({
    "a2a:enquiry:one": JSON.stringify({
      sent_at: "2026-09-06T12:00:00.000Z",
      celebrant_slug: "example",
      agent_name: "Test agent",
    }),
  });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async () =>
    new Response("provider failure", { status: 503 });
  console.error = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  });

  await processWeeklyEnquiryDigest(
    {
      KV,
      RESEND_API_KEY: "test",
      FROM_EMAIL: "from@example.test",
      ADMIN_EMAIL: "admin@example.test",
    },
    now,
  );
  assert.equal(KV.values.has("a2a:digest_sent:2026-09-07"), false);
});

test("A2A enquiry validation rejects impossible dates and unsafe contact URLs", () => {
  const valid = {
    celebrant_slug: "example",
    couple: { names: "Alex and Sam", email: "couple@example.test" },
    wedding: {
      date: "2027-05-14",
      location: "Hobart",
      notes: "We are planning a warm, relaxed ceremony with our families.",
    },
    agent: {
      name: "Helpful planner",
      contact_url: "https://planner.example.test/contact",
    },
  };
  assert.equal(validateEnquiry(valid), null);
  assert.match(
    validateEnquiry({
      ...valid,
      wedding: { ...valid.wedding, date: "2027-02-30" },
    }),
    /YYYY-MM-DD/,
  );
  assert.match(
    validateEnquiry({
      ...valid,
      agent: { ...valid.agent, contact_url: "javascript:alert(1)" },
    }),
    /HTTP or HTTPS/,
  );
});

test("A2A returns no JSON-RPC body for a valid notification", async () => {
  const response = await handleA2A(
    new Request("https://api.example.test/a2a", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
    }),
    {},
  );
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});
