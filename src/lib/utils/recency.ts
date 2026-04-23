// Look up the first-commit timestamp for each directory entry so newly added
// celebrants can be pinned to the top of their tier on listing pages that have
// a cap — otherwise a new Registered celebrant only wins a slot on ~30% of
// builds and can take several deploys to appear.
//
// We use git's first-commit time via `git log --diff-filter=A`. An absolute
// "added in the last N days" threshold doesn't work for this repo because most
// listings were bulk-committed on the same day; instead we rank by timestamp
// and pin the N most recently added celebrants.

import { execSync } from "node:child_process";

const CONTENT_DIR = "src/content/directory";

// How many of the most-recently-added celebrants get pinned to the top of
// their tier bucket. 6 ≈ about one month of normal intake — long enough for a
// new listing to survive a couple of deploys before settling into the random
// rotation, short enough that the boost never dominates the home page.
const PIN_TOP_N = 6;

let creationTimes: Map<string, number> | null = null;
let pinnedSet: Set<string> | null = null;

function loadCreationTimes(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const log = execSync(
      `git log --all --diff-filter=A --name-only --reverse --pretty=format:"__TS__%at" -- ${CONTENT_DIR}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    let currentTs = 0;
    for (const line of log.split("\n")) {
      if (line.startsWith("__TS__")) {
        currentTs = parseInt(line.slice(6), 10) * 1000;
      } else if (line.trim() && /\.mdx?$/.test(line)) {
        const id = line.replace(/^src\/content\/directory\//, "").replace(/\.mdx?$/, "");
        if (!out.has(id)) out.set(id, currentTs);
      }
    }
  } catch {
    // Git unavailable (shallow clone, no .git, etc.) — callers treat "unknown"
    // as "not pinned", which is safe.
  }
  return out;
}

function loadPinnedSet(): Set<string> {
  const times = loadCreationTimes();
  const ranked = [...times.entries()]
    .filter(([id]) => !id.startsWith("-")) // exclude -template etc.
    .sort((a, b) => b[1] - a[1])
    .slice(0, PIN_TOP_N)
    .map(([id]) => id);
  return new Set(ranked);
}

export function getCreationTime(id: string): number | null {
  if (!creationTimes) creationTimes = loadCreationTimes();
  return creationTimes.get(id) ?? null;
}

/** True if this celebrant is one of the N most recently added — pin to top of tier. */
export function isRecentlyAdded(id: string): boolean {
  if (!pinnedSet) pinnedSet = loadPinnedSet();
  return pinnedSet.has(id);
}
