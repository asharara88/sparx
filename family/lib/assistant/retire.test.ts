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
