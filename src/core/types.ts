export type AgentProvider = "opencode" | "claude-agent";

export type CreateAgentOptions = {
  provider: AgentProvider;
  model?: string;
  cwd?: string;
  apiKey?: string;
  baseUrl?: string;
  providerOptions?: Record<string, unknown>;
};

export type AgentRunInput = {
  prompt: string;
  system?: string;
  cwd?: string;
  context?: Array<{ type: "text"; text: string }>;
  approvalMode?: "default" | "auto" | "manual";
  maxTurns?: number;
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "status"; status: "running" | "completed" | "failed" }
  | { type: "error"; error: string };

export type AgentRunResult = {
  provider: AgentProvider;
  model?: string;
  text: string;
  events: AgentEvent[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  raw?: unknown;
};

export type AnyAgent = {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
};
