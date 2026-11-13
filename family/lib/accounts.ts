/**
 * What the Members screen says beside a name about their account (migration 5300's
 * members_accounts). A plain module, so both the server-rendered list and the client
 * invite button can use it: a "use client" file cannot lend a function to a server page.
 * Someone who has signed in gets no pill at all: fine is the absence of colour (DESIGN rule 7).
 */
export type AccountState = "signed_in" | "never" | "none";

export function accountLabel(state: AccountState | undefined): string {
  if (state === "signed_in") return "Signed in";
  if (state === "never") return "Not signed in";
  return "No account";
}
