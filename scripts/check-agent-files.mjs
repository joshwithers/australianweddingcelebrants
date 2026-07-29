import { readFile } from "node:fs/promises";

const [llmsText, robotsText] = await Promise.all([
  readFile(new URL("../dist/llms.txt", import.meta.url), "utf8"),
  readFile(new URL("../dist/robots.txt", import.meta.url), "utf8"),
]);

const fail = (message) => {
  console.error(`Agent file validation failed: ${message}`);
  process.exitCode = 1;
};

if (!llmsText.startsWith("# Australian Wedding Celebrants\n")) {
  fail("llms.txt must start with the site H1.");
}

if (!/^> .+/m.test(llmsText)) {
  fail("llms.txt must include a short summary after its H1.");
}

const markdownLinks = [
  ...llmsText.matchAll(/\[[^\]\n]+\]\(https:\/\/[^)\s]+\)/g),
];
if (markdownLinks.length < 10) {
  fail(
    `llms.txt must contain Markdown links to key content; found ${markdownLinks.length}.`,
  );
}

if (/→\s+https:\/\//.test(llmsText)) {
  fail("llms.txt still contains legacy bare profile URLs.");
}

const robotsLines = robotsText
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*/, "").trim())
  .filter(Boolean);
const userAgentIndex = robotsLines.findIndex(
  (line) => line.toLowerCase() === "user-agent: *",
);
const nextUserAgentIndex = robotsLines.findIndex(
  (line, index) =>
    index > userAgentIndex && line.toLowerCase().startsWith("user-agent:"),
);
const blockEnd =
  nextUserAgentIndex === -1 ? robotsLines.length : nextUserAgentIndex;
const expectedSignal =
  /^content-signal:\s*ai-train=no,\s*search=yes,\s*ai-input=yes$/i;
const signalIndex = robotsLines.findIndex((line) => expectedSignal.test(line));

if (userAgentIndex === -1) {
  fail("robots.txt must include a User-agent: * block.");
}

if (signalIndex <= userAgentIndex || signalIndex >= blockEnd) {
  fail(
    "robots.txt must include the active Content-Signal directive in the User-agent: * block.",
  );
}

if (
  !robotsLines.some((line) =>
    /^sitemap:\s*https:\/\/australianweddingcelebrants\.com\.au\/sitemap-index\.xml$/i.test(
      line,
    ),
  )
) {
  fail("robots.txt must reference the canonical sitemap index.");
}

if (!process.exitCode) {
  console.log(
    `Validated llms.txt (${markdownLinks.length} Markdown links) and robots.txt Content Signals.`,
  );
}
