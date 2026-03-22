export type AgentErrorCode = "unsupported-provider" | "not-implemented" | "provider-error";

export type AgentErrorOptions = {
  cause?: unknown;
  details?: Record<string, unknown>;
};

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(code: AgentErrorCode, message: string, options?: AgentErrorOptions) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}
