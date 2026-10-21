import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "./csrf.ts";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
const url = "https://elnunu.com/api/view-as";

test("our own form posts pass", () => {
  assert.equal(sameOrigin(h({ "sec-fetch-site": "same-origin", origin: "https://elnunu.com" }), url), true);
  assert.equal(sameOrigin(h({ origin: "https://elnunu.com" }), url), true);
  assert.equal(sameOrigin(h({ "sec-fetch-site": "none" }), url), true);
  assert.equal(sameOrigin(h({}), url), true);
});

test("a post from another site is refused", () => {
  assert.equal(sameOrigin(h({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }), url), false);
  assert.equal(sameOrigin(h({ origin: "https://evil.example" }), url), false);
  assert.equal(sameOrigin(h({ "sec-fetch-site": "same-site", origin: "https://other.elnunu.com" }), url), false);
  assert.equal(sameOrigin(h({ origin: "not a url" }), url), false);
});
