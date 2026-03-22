# any-agent-sdk specification proposal

## Problem

AI coding agent SDKs expose different APIs for:

- starting runs
- streaming partial output
- surfacing tool calls
- managing sessions/threads
- reporting usage and lifecycle state

That makes application code provider-specific.

## Objective

`any-agent-sdk` provides a common TypeScript interface that lets callers switch agent backends with minimal application changes.

## Non-goals (initially)

- perfectly identical provider behavior
- full abstraction over every provider-specific feature
- browser-first SDK design

## Primary API

### createAgent

```ts
const agent = createAgent({
  provider: "opencode",
  model: "github-copilot/claude-opus-4.6",
  cwd: process.cwd(),
});
```

### run

```ts
const result = await agent.run({
  prompt: "Summarize this repository and suggest 3 refactors",
});
```

### stream

```ts
for await (const event of agent.stream({
  prompt: "Implement the requested change",
})) {
  // consume normalized events
}
```

## Type model

### Provider

```ts
type AgentProvider = "opencode" | "claude-agent";
```

### Common run input

```ts
type AgentRunInput = {
  prompt: string;
  system?: string;
  cwd?: string;
  context?: Array<{ type: "text"; text: string }>;
  approvalMode?: "default" | "auto" | "manual";
  maxTurns?: number;
  metadata?: Record<string, unknown>;
};
```

### Common events

```ts
type AgentEvent =
  | { type: "status"; status: "running" | "completed" | "failed" }
  | { type: "text-delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "error"; error: string };
```

### Common result

```ts
type AgentRunResult = {
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
```

## Provider contract

Each provider adapter should implement something like:

```ts
interface ProviderAdapter {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
```

## Normalization rules

### Text

- final user-visible text should be available as `result.text`
- incremental chunks should flow via `text-delta`

### Tools

- tool invocation becomes `tool-call`
- tool completion becomes `tool-result`
- raw provider payload may still be stored in `raw`

### Usage

- normalize token accounting when available
- allow partial usage data

### Errors

- provider exceptions should be wrapped in shared error classes later
- event streams should emit `error` before failing when practical

## Implementation status

The minimal skeleton now exists in `src/` with a working OpenCode adapter:

- shared types
- `createAgent` with provider dispatch
- OpenCode adapter (run + stream)
- Claude Agent adapter (placeholder)
- shared error model
- co-located tests for `createAgent` and OpenCode adapter

## OpenCode adapter surface

- `run()` uses `session.create` + `session.prompt`
- `stream()` uses `event.subscribe` + `session.promptAsync` when available, otherwise falls back to `run()`
- Text output is mapped from text parts; text deltas use `message.part.updated` events
- Tool parts emit `tool-call` + `tool-result` events
- Usage is mapped from `AssistantMessage.tokens` (input + output)
- Provider-specific options are passed via `providerOptions`
- `sessionId` + `continueSession` can be used to reuse an existing session

## Repo bootstrap note

This repository intentionally reuses the `rulesync` environment/tooling baseline, but starts without `src/` so the architecture can be designed before implementation.
