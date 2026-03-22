# OpenCode Provider

## Supported surface

- `run()` uses `session.create` + `session.prompt`
- `stream()` uses `event.subscribe` + `session.promptAsync` when available
- text events map to `text` / `text-delta`
- tool events map to `tool-call` / `tool-result`
- usage is mapped from `AssistantMessage.tokens` (input/output)

## Provider options

Pass OpenCode-specific settings under `providerOptions` in `createAgent`:

```ts
const agent = createAgent({
  provider: "opencode",
  model: "opencode/model-id",
  providerOptions: {
    client,
    clientConfig,
    requestOptions,
    modelProviderId,
    agent,
  },
});
```

### Option fields

- `client`: preconfigured `OpencodeClient` instance
- `clientConfig`: forwarded to `createOpencodeClient`
- `requestOptions`: extra request options merged into SDK calls
- `modelProviderId`: default provider id when `model` lacks a `/` separator
- `agent`: OpenCode agent name to use with `session.prompt`
- `sessionId`: reuse an existing session ID when paired with `continueSession`
- `continueSession`: when true, `sessionId` is used instead of creating a new session

## Notes and limitations

- `approvalMode`, `maxTurns`, and `metadata` are not currently mapped
- streaming requires the OpenCode event SSE endpoint to be available
- stream completion is inferred from `step-finish` events
