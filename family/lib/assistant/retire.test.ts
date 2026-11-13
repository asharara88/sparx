import { test } from "node:test";
import assert from "node:assert/strict";
import { retireProposals } from "./retire.ts";
import type { AssistantProposal } from "../types.ts";

const p = (id: string, kind: string): AssistantProposal => ({ id, kind, summary: id }) as unknown as AssistantProposal;
const msgs = [{ proposals: [p("shop1", "shopping"), p("shop2", "shopping"), p("shop3", "shopping"), p("feed", "care_entry"), p("cal", "calendar_event")] }];

test("retireProposals: a shopping card from an older chat cannot be confirmed any more", () => {
  const out = retireProposals(msgs, {
    shop1: { status: "pending" },
    shop2: { status: "error", message: "boom" },
    shop3: { status: "saved", href: "/shopping", note: "On the list." },
    feed: { status: "pending" },
    cal: { status: "saved", href: "/calendar", note: "On the calendar." },
  });
  assert.deepEqual(out.shop1, { status: "dropped" }, "a pending card is shown as not saved");
  assert.deepEqual(out.shop2, { status: "dropped" }, "and so is a failed one");
  assert.deepEqual(out.shop3, { status: "saved", note: "On the list." }, "a saved card keeps its note and loses the dead link");
  assert.deepEqual(out.feed, { status: "pending" }, "a living kind is untouched");
  assert.deepEqual(out.cal, { status: "saved", href: "/calendar", note: "On the calendar." }, "and keeps a living link");
});

test("retireProposals: a card with no saved state counts as pending and is dropped; a living card's dead link goes", () => {
  const out = retireProposals(msgs, { feed: { status: "saved", href: "/house/tickets/1", note: "Saved." } });
  assert.deepEqual(out.shop1, { status: "dropped" });
  assert.deepEqual(out.feed, { status: "saved", note: "Saved." });
});

test("replacedBy: a correction replaces the latest waiting card about the same thing, and only that", async () => {
  const { replacedBy } = await import("./retire.ts");
  const card = (id: string, type_id: string, extra: object = {}) => ({ id, kind: "care_entry" as const, summary: id, care_entry: { type_id } as never, ...extra });
  const msgs = [{ proposals: [card("a", "lana.feed"), card("b", "lana.diaper")] }, { proposals: [card("c", "lana.feed")] }];
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.feed", { replaces: true })], {}), ["c"]);
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.feed", { replaces: true })], { c: { status: "saved", note: "Saved." } }), ["a"], "a saved card is never replaced");
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.feed")], {}), [], "no replaces flag, nothing replaced");
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.sleep", { replaces: true })], {}), [], "nothing about sleep to replace");
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.feed", { replaces: true })], { c: { status: "error", message: "offline" } }), ["c"], "a card whose save failed is replaced, so Try again cannot save it too");
  assert.deepEqual(replacedBy(msgs, [card("d", "lana.feed", { replaces: true })], { c: { status: "saving" } }), ["a"], "a card being saved is left alone");
});

test("retireProposals: every kind the helper writes today stays confirmable after a reload", () => {
  const kinds = ["custody", "entry_change", "entry_delete", "milk_add", "milk_move", "medicine_dose", "vaccines"];
  const out = retireProposals([{ proposals: kinds.map((k) => p(k, k)) }], Object.fromEntries(kinds.map((k) => [k, { status: "pending" as const }])));
  for (const k of kinds) assert.deepEqual(out[k], { status: "pending" }, k);
});

test("replacedBy: a corrected handover replaces the handover card, a corrected change replaces the change to the same entry", async () => {
  const { replacedBy } = await import("./retire.ts");
  const hand = (id: string, member: string, replaces = false) => ({ id, kind: "custody", summary: id, custody: { subject_id: "lana", subject_name: "Lana", member_id: member, member_name: member }, ...(replaces ? { replaces: true } : {}) }) as AssistantProposal;
  const change = (id: string, entry: string, replaces = false) => ({ id, kind: "entry_change", summary: id, entry_change: { entry_id: entry }, ...(replaces ? { replaces: true } : {}) }) as unknown as AssistantProposal;
  const earlier = [{ proposals: [hand("h1", "dana"), change("c1", "e1"), change("c2", "e2")] }];
  assert.deepEqual(replacedBy(earlier, [hand("h2", "wafa", true)], {}), ["h1"]);
  assert.deepEqual(replacedBy(earlier, [change("c3", "e2", true)], {}), ["c2"], "the change to the same entry, not the latest change");
});
