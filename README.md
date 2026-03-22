# any-agent-sdk

OpenCode-like unified SDK wrapper for AI coding agents.

## Goal

Provide the same high-level interface regardless of the underlying agent SDK.

Initial targets:

- OpenCode SDK (implemented)
- Claude Agent SDK (placeholder)

Design direction:

- **OpenCode-like interface first**
- provider-specific differences normalized behind adapters
- streaming, tool calls, text output, and session handling exposed consistently

## Status

OpenCode adapter has a minimal working implementation. Claude Agent adapter is still a placeholder.

## Minimal SDK shape

### Core idea

```ts
import { createAgent } from "any-agent-sdk";

const agent = createAgent({
  provider: "opencode",
  model: "github-copilot/claude-opus-4.6",
});

const result = await agent.run({
  prompt: "Review this diff and suggest a safer refactor",
});
```

The same call shape should work for:

- `provider: "opencode"`
- `provider: "claude-agent"`

## API principles

1. **Single run interface**
   - `agent.run({ prompt, cwd?, context?, approvalMode? })`
2. **Streaming-first**
   - async iterator for text / tool / lifecycle events
3. **Session-aware**
   - create or resume sessions/threads consistently
4. **Structured results**
   - normalized final result shape across providers
5. **Provider escape hatches**
   - raw provider options available without polluting the common interface

## Normalized interface

```ts
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

export interface AnyAgent {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
```

## Adapter design

Internal split (now present):

- `src/core/types.ts`
- `src/core/adapter.ts`
- `src/core/errors.ts`
- `src/providers/opencode/adapter.ts`
- `src/providers/claude-agent/adapter.ts`
- `src/create-agent.ts`

Each provider adapter maps native SDK responses into the shared event/result model.

## Provider status

- OpenCode: run + stream (SSE-backed), text, tool events, basic usage mapping
- Claude Agent: not implemented yet

## Milestones

### v0 (in progress)

- provider selection
- `run()`
- `stream()`
- normalized text output
- normalized tool-call/tool-result events
- OpenCode SDK adapter (in progress)
- Claude Agent SDK adapter

## Open design questions

- How close should the API stay to OpenCode when Claude Agent differs?
- Should session/thread APIs be part of `createAgent()` or separate factories?
- How much provider-native event detail should be exposed in normalized events?
- Do we normalize tool schemas strictly, or expose raw payloads with light wrapping?

## Spec

See `docs/spec.md` for the initial specification proposal.
