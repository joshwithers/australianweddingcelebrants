import assert from "node:assert/strict";
import test from "node:test";

import { onRequest, prefersMarkdown } from "../functions/_middleware.js";
import { handleMcp } from "../worker/src/mcp.js";

test("markdown negotiation honours explicit quality values", () => {
  assert.equal(prefersMarkdown("text/markdown"), true);
  assert.equal(prefersMarkdown("text/html, text/markdown;q=0.8"), true);
  assert.equal(prefersMarkdown("text/html, text/markdown;q=0"), false);
  assert.equal(prefersMarkdown("text/html, */*"), false);
});

test("markdown middleware preserves upstream headers and handles HEAD without a body", async () => {
  const next = async (target) => {
    if (target) {
      assert.equal(target.pathname, "/about.md");
      return new Response("# About", {
        headers: { "Cache-Control": "public, max-age=60", "X-Origin": "pages" },
      });
    }
    return new Response("<h1>About</h1>", { headers: { "X-Origin": "html" } });
  };

  const response = await onRequest({
    request: new Request("https://example.test/about/", {
      method: "HEAD",
      headers: { Accept: "text/markdown" },
    }),
    next,
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  assert.equal(response.headers.get("X-Origin"), "pages");
  assert.match(response.headers.get("Vary"), /Accept/i);
  assert.equal(await response.text(), "");
});

test("MCP rejects invalid and empty-batch JSON-RPC requests", async () => {
  for (const body of [
    "null",
    "[]",
    JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }),
  ]) {
    const response = await handleMcp(
      new Request("https://api.example.test/mcp", { method: "POST", body }),
      {},
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.error.code, -32600);
  }
});

test("MCP suppresses notification responses, including known methods in a batch", async () => {
  const notification = await handleMcp(
    new Request("https://api.example.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
    }),
    {},
  );
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");

  const batch = await handleMcp(
    new Request("https://api.example.test/mcp", {
      method: "POST",
      body: JSON.stringify([
        { jsonrpc: "2.0", method: "ping", id: 7 },
        { jsonrpc: "2.0", method: "tools/list" },
      ]),
    }),
    {},
  );
  const payload = await batch.json();
  assert.equal(payload.length, 1);
  assert.deepEqual(payload[0], { jsonrpc: "2.0", id: 7, result: {} });
});
