/**
 * What the Members screen says under a name about their account (migration 5300's
 * members_accounts). A plain module, so both the server-rendered list and the client
 * invite button can use it: a "use client" file cannot lend a function to a server page.
 */
export type AccountState = "signed_in" | "never" | "none";

export function accountLabel(state: AccountState | undefined): string {
  if (state === "signed_in") return "Signed in";
  if (state === "never") return "Has not signed in yet";
  return "No account yet";
}
