// Claude-in-Chrome MCP path ("act on Chrome" = supervised/interactive control).
// At runtime, the host (Claude desktop) exposes mcp__Claude_in_Chrome__* tools; the
// pipeline does not call them directly — instead it surfaces an action request that a
// human (via Claude) executes in the real browser. This module documents that contract.
export interface ChromeMcpActionRequest {
  intent: string;                 // e.g. "review YouTube upload before publishing"
  url?: string;
  notes?: string;
}
export function requestSupervisedAction(req: ChromeMcpActionRequest): ChromeMcpActionRequest {
  // Producer/agents emit this; the orchestration host routes it to Claude-in-Chrome.
  return req;
}
