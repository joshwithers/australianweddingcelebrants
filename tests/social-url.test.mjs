import assert from "node:assert/strict";
import test from "node:test";

import { cleanSocialUrl } from "../src/lib/utils/socialUrl.ts";

test("removes Instagram share tracking", () => {
  assert.equal(
    cleanSocialUrl(
      "https://www.instagram.com/reneepaxton_celebrant?igsh=dXU3cnN4dmhxczY1",
    ),
    "https://www.instagram.com/reneepaxton_celebrant",
  );
});

test("removes campaign and platform tracking while preserving functional parameters", () => {
  assert.equal(
    cleanSocialUrl(
      "https://www.youtube.com/watch?v=abc123&list=PL123&si=share-token&utm_source=instagram#chapter",
    ),
    "https://www.youtube.com/watch?v=abc123&list=PL123#chapter",
  );
  assert.equal(
    cleanSocialUrl(
      "https://www.facebook.com/profile.php?id=123&mibextid=abc&fbclid=tracking",
    ),
    "https://www.facebook.com/profile.php?id=123",
  );
});

test("leaves legitimate and malformed URLs unchanged", () => {
  assert.equal(
    cleanSocialUrl("https://example.com/profile?theme=dark"),
    "https://example.com/profile?theme=dark",
  );
  assert.equal(cleanSocialUrl("not a URL"), "not a URL");
});
