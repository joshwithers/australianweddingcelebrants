// ChatGPT Apps SDK widgets — served by worker/src/mcp.js via
// `resources/list` + `resources/read`. Each tool response carries
// `_meta: { "openai/outputTemplate": "ui://widget/<name>.html" }` so ChatGPT
// fetches the corresponding widget and renders it inline, bound to the
// tool's `structuredContent` via `window.openai.toolOutput`.
//
// Widgets are intentionally self-contained — no external assets, no
// frameworks — so they load instantly inside the Apps SDK sandbox.

export const WIDGET_LIST_URI = "ui://widget/celebrant-list.html";
export const WIDGET_PROFILE_URI = "ui://widget/celebrant-profile.html";

export const WIDGETS = {
  [WIDGET_LIST_URI]: {
    name: "celebrant-list",
    title: "Celebrant list",
    description: "Grid of celebrant cards with tier pills, locations, and links.",
    html: celebrantListHtml(),
  },
  [WIDGET_PROFILE_URI]: {
    name: "celebrant-profile",
    title: "Celebrant profile",
    description: "A single celebrant's full profile rendered as a rich card.",
    html: celebrantProfileHtml(),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// celebrant-list widget — used by search_celebrants, browse_by_location,
// browse_by_tier, list_all_celebrants. Auto-picks the heading based on which
// shape of structuredContent it was given.
// ─────────────────────────────────────────────────────────────────────────────

function celebrantListHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: transparent;
    --ink: #222;
    --ink-light: #6a6a6a;
    --ink-mid: #444;
    --border: #ececec;
    --luminary: #460479;
    --endorsed: #92174d;
    --registered-bg: #f0f0f0;
    --registered-ink: #444;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { padding: 12px; }
  header { margin: 0 0 14px; }
  header h2 { margin: 0 0 3px; font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }
  header .sub { color: var(--ink-light); font-size: 13px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }
  .card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .row { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; }
  .card h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.15px;
    line-height: 1.25;
    word-wrap: break-word;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2px;
    white-space: nowrap;
    text-transform: capitalize;
    flex-shrink: 0;
  }
  .pill.luminary { background: var(--luminary); color: #fff; }
  .pill.endorsed { background: var(--endorsed); color: #fff; }
  .pill.registered { background: var(--registered-bg); color: var(--registered-ink); }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .badge {
    font-size: 11px;
    background: #f5f3f9;
    color: var(--luminary);
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 500;
  }
  .locations {
    color: var(--ink-light);
    font-size: 12px;
    line-height: 1.35;
  }
  .desc {
    font-size: 13px;
    color: var(--ink-mid);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.45;
  }
  a.view {
    color: var(--luminary);
    text-decoration: none;
    font-size: 12px;
    font-weight: 500;
    margin-top: auto;
  }
  a.view:hover { text-decoration: underline; }
  .empty {
    padding: 20px;
    color: var(--ink-light);
    text-align: center;
    font-size: 14px;
    background: #fafafa;
    border: 1px dashed var(--border);
    border-radius: 10px;
  }
</style>
</head>
<body>
<div class="wrap" id="root"></div>
<script>
(function () {
  var data = (window.openai && window.openai.toolOutput) || {};
  var root = document.getElementById("root");
  var cels = Array.isArray(data.celebrants) ? data.celebrants : [];

  var title = "Celebrants";
  var sub = cels.length + " celebrant" + (cels.length === 1 ? "" : "s");
  if (data.query) {
    title = "Search results for \\u201c" + esc(data.query) + "\\u201d";
  } else if (data.location) {
    title = "Celebrants for " + esc(data.location);
    if (typeof data.traveler_count === "number" && data.traveler_count > 0) {
      sub = data.local_count + " local + " + data.traveler_count + " travel Australia-wide";
    }
  } else if (data.tier) {
    title = cap(data.tier) + " celebrants";
  } else {
    title = "Australian Wedding Celebrants";
  }

  var header =
    "<header><h2>" + esc(title) + "</h2><div class=\\"sub\\">" + esc(sub) + "</div></header>";

  if (cels.length === 0) {
    root.innerHTML = header +
      "<div class=\\"empty\\">No celebrants matched. Try a different location, specialty, or tier.</div>";
    return;
  }

  var cards = cels.map(function (c) {
    var tier = c.tier || "registered";
    var locations = Array.isArray(c.locations) ? c.locations : [];
    var badges = [];
    if (c.travels) badges.push("Travels Australia-wide");
    if (c.australia_wide && !c.travels) badges.push("Australia-wide");
    if (c.international) badges.push("International");
    var badgeHtml = badges.length
      ? "<div class=\\"badges\\">" + badges.map(function (b) { return "<span class=\\"badge\\">" + esc(b) + "</span>"; }).join("") + "</div>"
      : "";
    return (
      "<article class=\\"card\\">" +
        "<div class=\\"row\\">" +
          "<h3>" + esc(c.name || "") + "</h3>" +
          "<span class=\\"pill " + esc(tier) + "\\">" + cap(tier) + "</span>" +
        "</div>" +
        badgeHtml +
        "<div class=\\"locations\\">" + locations.map(esc).join(" &middot; ") + "</div>" +
        (c.description ? "<div class=\\"desc\\">" + esc(c.description) + "</div>" : "") +
        "<a class=\\"view\\" href=\\"" + esc(c.url || "#") + "\\" target=\\"_blank\\" rel=\\"noopener\\">View profile &rarr;</a>" +
      "</article>"
    );
  }).join("");

  root.innerHTML = header + "<div class=\\"grid\\">" + cards + "</div>";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cap(s) {
    s = String(s || "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
</script>
</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// celebrant-profile widget — used by get_celebrant_profile. Renders the
// markdown profile as HTML with a small built-in parser (headings, bold,
// italic, links, lists, blockquotes, hr, paragraphs).
// ─────────────────────────────────────────────────────────────────────────────

function celebrantProfileHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: transparent;
    --ink: #222;
    --ink-light: #6a6a6a;
    --border: #ececec;
    --luminary: #460479;
    --accent-bg: #faf7f5;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 18px 20px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    margin: 12px;
  }
  .md h1 { font-size: 19px; font-weight: 700; letter-spacing: -0.3px; margin: 0 0 8px; }
  .md h2 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; color: var(--luminary); letter-spacing: -0.1px; text-transform: uppercase; letter-spacing: 0.5px; }
  .md h3 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; }
  .md p { margin: 6px 0; font-size: 14px; }
  .md ul { margin: 6px 0 10px; padding-left: 20px; }
  .md li { margin: 3px 0; font-size: 14px; }
  .md hr { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }
  .md a { color: var(--luminary); text-decoration: none; }
  .md a:hover { text-decoration: underline; }
  .md strong { color: var(--ink); font-weight: 600; }
  .md em { font-style: italic; }
  .md code {
    background: #f3f0f7;
    color: var(--luminary);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .md blockquote {
    margin: 10px 0;
    padding: 8px 14px;
    background: var(--accent-bg);
    border-left: 3px solid var(--luminary);
    color: #444;
    font-size: 14px;
    font-style: italic;
    border-radius: 0 8px 8px 0;
  }
  .footer {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }
  .footer a {
    color: var(--luminary);
    text-decoration: none;
    font-weight: 500;
  }
  .footer a:hover { text-decoration: underline; }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--ink-light);
    font-size: 14px;
  }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var data = (window.openai && window.openai.toolOutput) || {};
  var root = document.getElementById("root");

  var md = String(data.profile_markdown || "").trim();
  var url = data.url || "";

  if (!md) {
    root.innerHTML = "<div class=\\"card\\"><div class=\\"empty\\">No profile data.</div></div>";
    return;
  }

  var body = mdToHtml(md);
  var footer = url
    ? "<div class=\\"footer\\"><a href=\\"" + esc(url) + "\\" target=\\"_blank\\" rel=\\"noopener\\">View full profile on australianweddingcelebrants.com.au &rarr;</a></div>"
    : "";

  root.innerHTML = "<div class=\\"card\\"><div class=\\"md\\">" + body + "</div>" + footer + "</div>";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    s = s.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
    s = s.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function (_, t, u) {
      return "<a href=\\"" + u + "\\" target=\\"_blank\\" rel=\\"noopener\\">" + t + "</a>";
    });
    return s;
  }

  function mdToHtml(text) {
    var lines = text.split(/\\r?\\n/);
    var out = [];
    var inList = false;
    var i = 0;
    function closeList() { if (inList) { out.push("</ul>"); inList = false; } }

    while (i < lines.length) {
      var line = lines[i];
      if (/^\\s*---+\\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
      var h = line.match(/^(#{1,6})\\s+(.*)$/);
      if (h) { closeList(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      var bq = line.match(/^>\\s?(.*)$/);
      if (bq) {
        closeList();
        var buf = [bq[1]];
        i++;
        while (i < lines.length && /^>\\s?(.*)$/.test(lines[i])) {
          buf.push(lines[i].match(/^>\\s?(.*)$/)[1]);
          i++;
        }
        out.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>");
        continue;
      }
      var li = line.match(/^[-*]\\s+(.*)$/);
      if (li) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inline(li[1]) + "</li>");
        i++; continue;
      }
      if (line.trim() === "") { closeList(); i++; continue; }
      closeList();
      out.push("<p>" + inline(line) + "</p>");
      i++;
    }
    closeList();
    return out.join("");
  }
})();
</script>
</body>
</html>
`;
}
