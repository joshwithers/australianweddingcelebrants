import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "node-html-parser";

const home = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);

test("homepage defers directory photographs and embeds the unchanged hero artwork", async () => {
  const html = parse(home);
  const photographs = html.querySelectorAll(".directory-card-img");
  assert.ok(photographs.length > 0);
  for (const image of photographs) {
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.notEqual(image.getAttribute("fetchpriority"), "high");
  }
  const heroStyle = html.querySelector(".hero-section").getAttribute("style");
  const encoded = heroStyle.match(/data:image\/svg\+xml,([^"]+)/)[1];
  assert.equal(
    decodeURIComponent(encoded),
    await readFile(new URL("../public/hero-bg.svg", import.meta.url), "utf8"),
  );
  assert.equal(
    html.querySelector('link[as="image"][href="/hero-bg.svg"]'),
    null,
  );
  const directory = parse(
    await readFile(
      new URL("../dist/directory/index.html", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    directory.querySelectorAll('.directory-card-img[fetchpriority="high"]')
      .length,
    1,
  );
});

for (const idleSupported of [true, false]) {
  test(`analytics waits for load and paint, queues navigation once, preserves privacy (idle=${idleSupported})`, () => {
    const events = new Map();
    const frames = [];
    const deferred = [];
    const appended = [];
    const document = {
      readyState: "loading",
      title: "Home",
      referrer: "https://example.org/private?q=secret",
      addEventListener(name, callback) {
        events.set(name, callback);
      },
      createElement() {
        return { dataset: {} };
      },
      head: {
        appendChild(script) {
          appended.push(script);
        },
      },
    };
    const window = {
      location: {
        origin: "https://australianweddingcelebrants.com.au",
        pathname: "/",
        search: "?private=yes",
      },
      addEventListener(name, callback) {
        events.set(name, callback);
      },
    };
    if (idleSupported)
      window.requestIdleCallback = (callback) => deferred.push(callback);
    const context = {
      window,
      document,
      URL,
      Date,
      requestAnimationFrame: (callback) => frames.push(callback),
      setTimeout: (callback) => deferred.push(callback),
    };
    const scripts = parse(home)
      .querySelectorAll("script")
      .map((script) => script.textContent)
      .filter((text) => text.includes("window.gtag"));
    for (const script of scripts) runInNewContext(script, context);
    events.get("astro:page-load")();
    assert.equal(appended.length, 0);
    events.get("load")();
    frames.shift()();
    assert.equal(appended.length, 0);
    frames.shift()();
    assert.equal(appended.length, 0);
    // Navigate before the deferred loader runs: preserve both queued page views.
    window.location.pathname = "/directory/";
    document.title = "Directory";
    for (const script of scripts) runInNewContext(script, context);
    events.get("astro:page-load")();
    deferred.shift()();
    assert.equal(deferred.length, 0);
    assert.equal(appended.length, 1);
    assert.equal(
      appended[0].src,
      "https://www.googletagmanager.com/gtag/js?id=G-DCYE3SSJQV",
    );
    assert.equal(appended[0].async, true);
    const queue = window.dataLayer.map((args) => Array.from(args));
    const views = queue.filter(
      (args) => args[0] === "event" && args[1] === "page_view",
    );
    assert.equal(views.length, 2);
    assert.equal(
      views[0][2].page_location,
      "https://australianweddingcelebrants.com.au/",
    );
    assert.equal(
      views[1][2].page_location,
      "https://australianweddingcelebrants.com.au/directory/",
    );
    assert.ok(
      views.every((args) => args[2].page_referrer === "https://example.org"),
    );
    assert.equal(queue.filter((args) => args[0] === "config").length, 1);
    assert.equal(queue[0][0], "consent");
    assert.ok(Object.values(queue[0][2]).every((value) => value === "denied"));
  });
}
