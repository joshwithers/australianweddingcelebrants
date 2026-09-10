#!/usr/bin/env node
// Mints a one-time admin magic-link by writing directly to the worker's KV
// namespace via wrangler. Prints a URL to click.
//
// Usage (from the worker/ directory):
//   node scripts/admin-login.mjs
//
// Requires: wrangler authenticated against the same Cloudflare account that
// owns the awc-listings worker, and the KV binding "KV" in wrangler.toml.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN_EMAIL = "hello@australianweddingcelebrants.com.au";
const WORKER_URL = "https://api.australianweddingcelebrants.com.au";
const TTL_SECONDS = 900;

const token = randomBytes(32).toString("hex");
const value = JSON.stringify({
  email: ADMIN_EMAIL,
  type: "celebrant",
  slug: null,
  mode: "new",
  created: Date.now(),
});

// wrangler kv key put reads from a file when --path is used — avoids shell
// escaping pitfalls with the JSON value.
const tmp = mkdtempSync(join(tmpdir(), "awc-admin-"));
const valueFile = join(tmp, "magic.json");
writeFileSync(valueFile, value);

try {
  execFileSync(
    "npx",
    [
      "wrangler",
      "kv",
      "key",
      "put",
      "--binding=KV",
      "--preview=false",
      "--remote",
      `--ttl=${TTL_SECONDS}`,
      `--path=${valueFile}`,
      `magic:${token}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const url = `${WORKER_URL}/auth?token=${token}`;
console.log("\nAdmin login URL (valid for 15 minutes, one-time use):\n");
console.log(`  ${url}\n`);
console.log("Open it in your browser — you'll land on the /admin dashboard.\n");
