// Typed errors so the orchestrator can distinguish retryable from fatal.
export class PipelineError extends Error {
  constructor(message: string, readonly retryable = false, readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}
export class LLMError extends PipelineError {}
export class ValidationError extends PipelineError {
  constructor(message: string, readonly issues?: unknown) { super(message, false); }
}
export class BudgetError extends PipelineError {}
export class AgentError extends PipelineError {
  constructor(readonly agent: string, message: string, retryable = false, cause?: unknown) {
    super(`[${agent}] ${message}`, retryable, cause);
  }
}
