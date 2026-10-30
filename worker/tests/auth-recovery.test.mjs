import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const workerUrl = "https://api.example.test";
const celebrantEmail = "celebrant@example.test";
const magicLinkLifetime = 15 * 60 * 1000;

function createHarness(t, { listing } = {}) {
  let now = Date.parse("2026-10-30T00:00:00.000Z");
  const values = new Map();
  const emails = [];
  const requests = [];
  const KV = {
    async get(key, options) {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        values.delete(key);
        return null;
      }
      return options?.type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    async put(key, value, options = {}) {
      values.set(key, {
        value,
        expiresAt: options.expirationTtl
          ? now + options.expirationTtl * 1000
          : null,
      });
    },
    async delete(key) {
      values.delete(key);
    },
  };

  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, method: options.method || "GET" });
    if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
      assert.equal(options.method, "POST");
      emails.push(JSON.parse(options.body));
      return Response.json({ id: `test-email-${emails.length}` });
    }
    if (url.origin === "https://api.github.com" && url.pathname === "/search/code") {
      return Response.json({
        items: listing
          ? [{ path: `src/content/directory/${listing.slug}.md` }]
          : [],
      });
    }
    if (
      listing &&
      url.origin === "https://api.github.com" &&
      url.pathname ===
        `/repos/example/directory/contents/src/content/directory/${listing.slug}.md`
    ) {
      return Response.json({
        content: Buffer.from(
          `---\ntitle: Example Celebrant\nemail: ${listing.email}\n---\nBiography.`,
        ).toString("base64"),
        sha: "test-file-sha",
        path: `src/content/directory/${listing.slug}.md`,
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  });

  const env = {
    KV,
    ADMIN_EMAIL: "admin@example.test",
    WORKER_URL: workerUrl,
    SITE_URL: "https://example.test",
    GITHUB_REPO: "example/directory",
    GITHUB_BRANCH: "main",
    CONTENT_PATH: "src/content/directory",
    GITHUB_TOKEN: "test-only",
    RESEND_API_KEY: "test-only",
    FROM_EMAIL: "from@example.test",
  };
  const fetch = (path, options) =>
    worker.fetch(new Request(new URL(path, workerUrl), options), env, {});

  return {
    KV,
    values,
    emails,
    requests,
    fetch,
    advance(milliseconds) {
      now += milliseconds;
    },
    login(fields = {}) {
      return fetch("/login", {
        method: "POST",
        body: new URLSearchParams({ email: celebrantEmail, mode: "new", ...fields }),
      });
    },
    latestAuthUrl() {
      const match = emails.at(-1)?.html.match(
        /href="(https:\/\/api\.example\.test\/auth\?token=[a-f0-9]+)"/,
      );
      assert.ok(match, "the email must contain a single-use authentication link");
      return match[1];
    },
  };
}

test("an expired signup can request a fresh link with the same email and open the listing form", async (t) => {
  const harness = createHarness(t);
  const firstSignup = await harness.login();
  assert.equal(firstSignup.status, 200);
  assert.match(await firstSignup.text(), /href="\/login\?expired=1"/);
  assert.ok(harness.emails[0].html.includes(`href="${workerUrl}/login?expired=1"`));
  const firstLink = harness.latestAuthUrl();
  assert.equal(await harness.KV.get(`email:${celebrantEmail}`), null);

  harness.advance(magicLinkLifetime + 1);
  const expired = await harness.fetch(firstLink);
  assert.equal(expired.status, 302);
  assert.equal(expired.headers.get("location"), "/login?expired=1");
  assert.equal(expired.headers.get("set-cookie"), null);
  assert.equal(
    [...harness.values.keys()].some((key) => key.startsWith("session:")),
    false,
  );

  const recovery = await harness.fetch(expired.headers.get("location"));
  assert.equal(recovery.status, 200);
  const recoveryHtml = await recovery.text();
  assert.match(recoveryHtml, /Request a new link/);
  assert.match(recoveryHtml, /Send new link/);
  assert.match(recoveryHtml, /same email address/i);

  const secondSignup = await harness.login({ email: " Celebrant@Example.Test " });
  assert.equal(secondSignup.status, 200);
  assert.equal(harness.emails.length, 2);
  assert.deepEqual(harness.emails[1].to, [celebrantEmail]);
  const secondLink = harness.latestAuthUrl();
  assert.notEqual(secondLink, firstLink);
  assert.equal(await harness.KV.get(`email:${celebrantEmail}`), null);

  const authenticated = await harness.fetch(secondLink);
  assert.equal(authenticated.status, 302);
  assert.equal(authenticated.headers.get("location"), "/form");
  const cookie = authenticated.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Max-Age=86400/);
  const form = await harness.fetch("/form", { headers: { Cookie: cookie } });
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Create Your Listing/);

  const usedAgain = await harness.fetch(secondLink);
  assert.equal(usedAgain.status, 302);
  assert.equal(usedAgain.headers.get("location"), "/login?expired=1");
  assert.equal(usedAgain.headers.get("set-cookie"), null);
});

test("login request limits still block repeated sends and expire after 15 minutes", async (t) => {
  const harness = createHarness(t);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await harness.login()).status, 200);
  }
  const blocked = await harness.login();
  assert.equal(blocked.status, 302);
  assert.match(blocked.headers.get("location"), /Too many login attempts/);
  assert.equal(harness.emails.length, 3);

  harness.advance(magicLinkLifetime + 1);
  assert.equal((await harness.login()).status, 200);
  assert.equal(harness.emails.length, 4);
  assert.equal(await harness.KV.get(`ratelimit:login:${celebrantEmail}`), "1");
});

test("an existing listing stays in the edit flow and requires its matching email", async (t) => {
  const slug = "example-celebrant";
  const harness = createHarness(t, { listing: { slug, email: celebrantEmail } });
  const existing = await harness.login();
  assert.equal(existing.status, 302);
  const location = new URL(existing.headers.get("location"), workerUrl);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("slug"), slug);
  assert.match(location.searchParams.get("error"), /already linked to a listing/);
  assert.equal(harness.emails.length, 0);
  assert.equal(await harness.KV.get(`email:${celebrantEmail}`), slug);

  const wrongEmail = await harness.login({
    email: "someone-else@example.test",
    mode: "edit",
    slug,
  });
  assert.equal(wrongEmail.status, 302);
  assert.match(wrongEmail.headers.get("location"), /doesn't match the listing/);
  assert.equal(harness.emails.length, 0);
  assert.equal(
    [...harness.values.keys()].some((key) => key.startsWith("magic:")),
    false,
  );

  const edit = await harness.login({ mode: "edit", slug });
  assert.equal(edit.status, 200);
  assert.equal(harness.emails.length, 1);
  assert.match(harness.emails[0].subject, /^Edit your listing/);
  const authenticated = await harness.fetch(harness.latestAuthUrl());
  assert.equal(authenticated.status, 302);
  const cookie = authenticated.headers.get("set-cookie");
  const sessionToken = cookie.match(/awc_session=([a-f0-9]+)/)[1];
  const session = JSON.parse(await harness.KV.get(`session:${sessionToken}`));
  assert.equal(session.mode, "edit");
  assert.equal(session.slug, slug);
  assert.equal(session.email, celebrantEmail);
  assert.equal(session.role, "celebrant");
});

test("signup confirmation and email offer a fresh-link route with edit context preserved", async (t) => {
  const slug = "example-celebrant";
  const harness = createHarness(t, { listing: { slug, email: celebrantEmail } });
  const confirmation = await harness.login({ mode: "edit", slug });
  const html = await confirmation.text();
  const recoveryPath = `/login?expired=1&amp;slug=${slug}`;
  assert.ok(html.includes(`href="${recoveryPath}"`));
  assert.ok(harness.emails[0].html.includes(`href="${workerUrl}${recoveryPath}"`));
  const recovery = await harness.fetch(`/login?expired=1&slug=${slug}`);
  const recoveryHtml = await recovery.text();
  assert.match(recoveryHtml, /Request a new link/);
  assert.match(recoveryHtml, /name="mode" value="edit"/);
  assert.ok(recoveryHtml.includes(`name="slug" value="${slug}"`));
});
