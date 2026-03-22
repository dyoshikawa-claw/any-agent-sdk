# any-agent-sdk

OpenCode-like unified SDK wrapper for AI coding agents.

## Goal

Provide the same high-level interface regardless of the underlying agent SDK.

Initial targets:
- OpenCode SDK
- Claude Agent SDK

Design direction:
- **OpenCode-like interface first**
- provider-specific differences normalized behind adapters
- streaming, tool calls, text output, and session handling exposed consistently

## Status

This repository is intentionally scaffolded from `rulesync` to keep the toolchain and development environment aligned.

Current state:
- environment/tooling copied from `rulesync`
- `src/` intentionally removed
- first-pass product/spec proposal added before implementation

## First-pass product shape

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

## Proposed API principles

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

## Proposed normalized interface

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

Planned internal split:
- `providers/opencode/*`
- `providers/claude-agent/*`
- `core/types.ts`
- `core/normalize.ts`
- `core/errors.ts`

Each provider adapter should map native SDK responses into the shared event/result model.

## Milestones

### v0
- provider selection
- `run()`
- `stream()`
- normalized text output
- normalized tool-call/tool-result events
- OpenCode SDK adapter
- Claude Agent SDK adapter

### v0.2
- session/thread abstraction
- resumable runs
- usage normalization
- provider capability introspection

### v0.3
- approval/tool policy abstraction
- shared test harness across providers
- fixtures for parity testing

## Open design questions

- How close should the API stay to OpenCode when Claude Agent differs?
- Should session/thread APIs be part of `createAgent()` or separate factories?
- How much provider-native event detail should be exposed in normalized events?
- Do we normalize tool schemas strictly, or expose raw payloads with light wrapping?

## Spec

See `docs/spec.md` for the initial specification proposal.
