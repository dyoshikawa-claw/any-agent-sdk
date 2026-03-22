import { describe, expect, it, vi } from "vitest";

import { createClaudeAgentAdapter } from "./claude-agent/adapter.js";
import { createOpenCodeAdapter } from "./opencode/adapter.js";

const createOpenCodeClientMock = () => {
  return {
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      promptAsync: vi.fn(),
    },
    event: {
      subscribe: vi.fn(),
    },
  };
};

const asyncEventStream = async function* (events: unknown[]) {
  for (const event of events) {
    yield event;
  }
};

const collectStreamEvents = async (stream: AsyncIterable<unknown>) => {
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const claudeRunQueryMock = async function* () {
  yield { type: "system", subtype: "init", model: "claude-sonnet" };
  yield {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Hello " },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { cmd: "pwd" } },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
        { type: "text", text: "world" },
      ],
    },
  };
  yield {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: "end_turn",
    errors: [],
  };
};

const claudeRunToolErrorQueryMock = async function* () {
  yield {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "fail",
          is_error: true,
          error: "tool failed",
        },
      ],
    },
  };
  yield { type: "result", subtype: "success", usage: { input_tokens: 0, output_tokens: 0 } };
};

const claudeStreamErrorQueryMock = async function* () {
  yield {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hel" },
    },
  };
  yield {
    type: "result",
    subtype: "error",
    errors: ["nope"],
  };
};

describe("provider parity", () => {
  it("OpenCode run conforms to the shared result contract", async () => {
    const client = createOpenCodeClientMock();
    client.session.create.mockResolvedValue({ data: { id: "session-1" } });
    client.session.prompt.mockResolvedValue({
      data: {
        info: {
          providerID: "opencode",
          modelID: "model-a",
          finish: "stop",
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          { type: "text", text: "Hello ", ignored: false },
          {
            type: "tool",
            tool: "shell",
            callID: "call-1",
            state: { status: "completed", input: { cmd: "pwd" }, output: "ok" },
          },
          { type: "text", text: "world", ignored: false },
        ],
      },
    });

    const adapter = createOpenCodeAdapter({
      provider: "opencode",
      model: "opencode/model-a",
      providerOptions: { client },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "opencode",
        text: "Hello world",
        events: expect.any(Array),
      }),
    );
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "tool-call", name: "shell", input: { cmd: "pwd" } },
        { type: "tool-result", name: "shell", output: "ok" },
      ]),
    );
  });

  it("OpenCode run emits error events when provider signals errors", async () => {
    const client = createOpenCodeClientMock();
    client.session.create.mockResolvedValue({ data: { id: "session-2" } });
    client.session.prompt.mockResolvedValue({
      data: {
        info: {
          providerID: "opencode",
          modelID: "model-b",
          finish: "stop",
          error: { data: { message: "boom" } },
        },
        parts: [{ type: "text", text: "done", ignored: false }],
      },
    });

    const adapter = createOpenCodeAdapter({
      provider: "opencode",
      providerOptions: { client },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result.events).toEqual(expect.arrayContaining([{ type: "error", error: "boom" }]));
  });

  it("OpenCode stream emits status lifecycle and error behavior", async () => {
    const client = createOpenCodeClientMock();
    client.session.create.mockResolvedValue({ data: { id: "session-3" } });
    client.session.promptAsync.mockResolvedValue({ data: undefined, error: undefined });
    client.event.subscribe.mockResolvedValue({
      stream: asyncEventStream([
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              sessionID: "session-3",
              messageID: "msg-1",
              type: "text",
              text: "Hello",
              ignored: false,
            },
            delta: "Hel",
          },
        },
        {
          type: "session.error",
          properties: {
            sessionID: "session-3",
            error: { data: { message: "stream failed" } },
          },
        },
      ]),
    });

    const adapter = createOpenCodeAdapter({
      provider: "opencode",
      providerOptions: { client },
    });

    const events = await collectStreamEvents(adapter.stream({ prompt: "stream" }));

    expect(events[0]).toEqual({ type: "status", status: "running" });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", text: "Hel" },
        { type: "error", error: "stream failed" },
        { type: "status", status: "failed" },
      ]),
    );
  });

  it("Claude Agent run conforms to the shared result contract", async () => {
    const adapter = createClaudeAgentAdapter({
      provider: "claude-agent",
      providerOptions: { query: claudeRunQueryMock },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result).toEqual(
      expect.objectContaining({
        provider: "claude-agent",
        text: "Hello world",
        events: expect.any(Array),
      }),
    );
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "tool-call", name: "Bash", input: { cmd: "pwd" } },
        { type: "tool-result", name: "Bash", output: "ok" },
      ]),
    );
  });

  it("Claude Agent run emits error events when tool results are errors", async () => {
    const adapter = createClaudeAgentAdapter({
      provider: "claude-agent",
      providerOptions: { query: claudeRunToolErrorQueryMock },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result.events).toEqual(
      expect.arrayContaining([{ type: "error", error: "tool failed" }]),
    );
  });

  it("Claude Agent stream emits status lifecycle and error behavior", async () => {
    const adapter = createClaudeAgentAdapter({
      provider: "claude-agent",
      providerOptions: { query: claudeStreamErrorQueryMock },
    });

    const events = await collectStreamEvents(adapter.stream({ prompt: "stream" }));

    expect(events[0]).toEqual({ type: "status", status: "running" });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", text: "Hel" },
        { type: "error", error: "nope" },
        { type: "status", status: "failed" },
      ]),
    );
  });
});
