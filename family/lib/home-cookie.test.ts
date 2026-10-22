import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_HEADER, homeId, resolveHome, withHome } from "./home-cookie.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("homeId: a uuid passes (lowercased), anything else is nothing", () => {
  assert.equal(homeId(A.toUpperCase()), A);
  assert.equal(homeId("not-a-uuid"), null);
  assert.equal(homeId(""), null);
  assert.equal(homeId(undefined), null);
});

test("resolveHome: the home a tab named wins over the cookie another tab moved", () => {
  // Tab 1 is bound to A and says so on its request; tab 2 switched the shared cookie to B meanwhile.
  assert.equal(resolveHome(A, B), A, "the request runs as the home the page named");
  assert.equal(resolveHome(null, B), B, "a request that names none runs as the device's cookie");
  assert.equal(resolveHome("garbage", B), B, "a header that is not an id counts as none");
  assert.equal(resolveHome(null, null), null, "and with neither, the account's choice applies");
});

test("withHome: the page's bound home goes on its internal API requests", () => {
  const init = withHome({ method: "POST", headers: { "content-type": "application/json" } }, A);
  assert.equal(new Headers(init?.headers).get(HOME_HEADER), A);
  assert.equal(new Headers(init?.headers).get("content-type"), "application/json", "other headers stay");
  assert.equal(init?.method, "POST");
  const own = withHome({ headers: { [HOME_HEADER]: B } }, A);
  assert.equal(new Headers(own?.headers).get(HOME_HEADER), B, "a request that already names a home keeps it");
  const unbound = { method: "GET" };
  assert.equal(withHome(unbound, null), unbound, "no bound home: the request goes as it is");
});
