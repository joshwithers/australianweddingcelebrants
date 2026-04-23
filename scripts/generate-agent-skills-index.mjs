#!/usr/bin/env node
/**
 * Regenerate public/.well-known/agent-skills/index.json from whatever
 * SKILL.md files live under public/.well-known/agent-skills/<name>/SKILL.md.
 *
 * Runs before `astro build` (see package.json scripts) so the digest in the
 * index always matches the SKILL.md file Astro will copy to dist/. Idempotent
 * — if no SKILL.md changed, the output is byte-identical.
 *
 * Each skill dir must contain a SKILL.md with at minimum a frontmatter block:
 *
 *     ---
 *     name: my-skill
 *     description: One-line explanation on a single line.
 *     ---
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_URL = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SITE = "https://australianweddingcelebrants.com.au";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(ROOT, "public", ".well-known", "agent-skills");
const INDEX_PATH = join(SKILLS_DIR, "index.json");

function parseFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (mm) {
      // Strip surrounding quotes if present.
      let value = mm[2];
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
        value = value.slice(1, -1);
      }
      out[mm[1]] = value;
    }
  }
  return out;
}

function discoverSkills() {
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const skillPath = join(SKILLS_DIR, slug, "SKILL.md");
    let md;
    try {
      md = readFileSync(skillPath, "utf8");
    } catch {
      continue; // dir with no SKILL.md — skip silently
    }

    const fm = parseFrontmatter(md);
    const name = fm.name || slug;
    const description = fm.description || "";
    if (!description) {
      console.warn(`[agent-skills] ${slug}/SKILL.md is missing a description in its frontmatter — including anyway.`);
    }

    const digest = "sha256:" + createHash("sha256").update(md).digest("hex");
    skills.push({
      name,
      type: "skill-md",
      description,
      url: `${SITE}/.well-known/agent-skills/${slug}/SKILL.md`,
      digest,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function main() {
  const skills = discoverSkills();
  const doc = {
    $schema: SCHEMA_URL,
    skills,
  };

  const next = JSON.stringify(doc, null, 2) + "\n";
  let prev = "";
  try {
    prev = readFileSync(INDEX_PATH, "utf8");
  } catch {}

  if (prev === next) {
    console.log(`[agent-skills] index.json unchanged (${skills.length} skill${skills.length === 1 ? "" : "s"}).`);
    return;
  }

  writeFileSync(INDEX_PATH, next);
  console.log(`[agent-skills] wrote ${skills.length} skill${skills.length === 1 ? "" : "s"} to index.json.`);
}

main();
