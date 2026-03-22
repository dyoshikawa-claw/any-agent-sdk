import { describe, expect, it } from "vitest";

import { createClaudeAgentAdapter } from "./adapter.js";

const createQueryMock = (messages: Array<Record<string, unknown>>) => {
  return async function* queryMock() {
    for (const message of messages) {
      yield message;
    }
  };
};

describe("Claude Agent adapter", () => {
  it("maps query output into run result", async () => {
    const queryMock = createQueryMock([
      {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-6",
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "tool_use", id: "tool-1", name: "Bash", input: { cmd: "pwd" } },
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "ok",
            },
            { type: "text", text: "world" },
          ],
        },
      },
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 4, output_tokens: 5 },
        stop_reason: "end_turn",
        errors: [],
      },
    ]);

    const adapter = createClaudeAgentAdapter({
      provider: "claude-agent",
      model: "claude-sonnet-4-6",
      providerOptions: { query: queryMock },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.text).toBe("Hello world");
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "tool-call", name: "Bash", input: { cmd: "pwd" } },
        { type: "tool-result", name: "Bash", output: "ok" },
      ]),
    );
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 5, totalTokens: 9 });
    expect(result.finishReason).toBe("end_turn");
  });

  it("streams text deltas and tool events", async () => {
    const queryMock = createQueryMock([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            id: "tool-9",
            name: "Read",
            input: { file_path: "/tmp/test.txt" },
          },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: {
            type: "tool_result",
            tool_use_id: "tool-9",
            content: "ok",
          },
        },
      },
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
        errors: [],
      },
    ]);

    const adapter = createClaudeAgentAdapter({
      provider: "claude-agent",
      providerOptions: { query: queryMock },
    });

    const events: Array<{ type: string }> = [];
    for await (const event of adapter.stream({ prompt: "stream" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "status", status: "running" });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", text: "Hel" },
        { type: "tool-call", name: "Read", input: { file_path: "/tmp/test.txt" } },
        { type: "tool-result", name: "Read", output: "ok" },
        { type: "status", status: "completed" },
      ]),
    );
  });
});
