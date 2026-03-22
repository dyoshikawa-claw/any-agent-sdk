import { describe, expect, it, vi } from "vitest";

import { createOpenCodeAdapter } from "./adapter.js";

const createClientMock = () => {
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

describe("OpenCode adapter", () => {
  it("maps prompt response into run result", async () => {
    const client = createClientMock();
    client.session.create.mockResolvedValue({ data: { id: "session-1" } });
    client.session.prompt.mockResolvedValue({
      data: {
        info: {
          providerID: "opencode",
          modelID: "model-a",
          finish: "stop",
          tokens: { input: 3, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          { type: "text", text: "Hello ", ignored: false },
          {
            type: "tool",
            tool: "shell",
            callID: "call-1",
            state: { status: "completed", input: { cmd: "ls" }, output: "ok" },
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

    expect(result.provider).toBe("opencode");
    expect(result.text).toBe("Hello world");
    expect(result.events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "tool-call", name: "shell", input: { cmd: "ls" } },
        { type: "tool-result", name: "shell", output: "ok" },
      ]),
    );
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(client.session.create).toHaveBeenCalledTimes(1);
  });

  it("reuses a provided session id when continueSession is true", async () => {
    const client = createClientMock();
    client.session.prompt.mockResolvedValue({
      data: {
        info: {
          providerID: "opencode",
          modelID: "model-a",
          finish: "stop",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [{ type: "text", text: "ok", ignored: false }],
      },
    });

    const adapter = createOpenCodeAdapter({
      provider: "opencode",
      providerOptions: {
        client,
        continueSession: true,
        sessionId: "session-keep",
      },
    });

    const result = await adapter.run({ prompt: "hi" });

    expect(result.text).toBe("ok");
    expect(client.session.create).not.toHaveBeenCalled();
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "session-keep" } }),
    );
  });

  it("streams text deltas and tool events", async () => {
    const client = createClientMock();
    client.session.create.mockResolvedValue({ data: { id: "session-2" } });
    client.session.promptAsync.mockResolvedValue({ data: undefined, error: undefined });
    client.event.subscribe.mockResolvedValue({
      stream: asyncEventStream([
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              sessionID: "session-2",
              messageID: "msg-1",
              type: "text",
              text: "Hello",
              ignored: false,
            },
            delta: "Hel",
          },
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "tool-1",
              sessionID: "session-2",
              messageID: "msg-1",
              type: "tool",
              tool: "shell",
              callID: "call-9",
              state: { status: "running", input: { cmd: "pwd" } },
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "tool-1",
              sessionID: "session-2",
              messageID: "msg-1",
              type: "tool",
              tool: "shell",
              callID: "call-9",
              state: { status: "completed", input: { cmd: "pwd" }, output: "done" },
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "step-1",
              sessionID: "session-2",
              messageID: "msg-1",
              type: "step-finish",
              reason: "stop",
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          },
        },
      ]),
    });

    const adapter = createOpenCodeAdapter({
      provider: "opencode",
      providerOptions: { client },
    });

    const events: Array<{ type: string }> = [];
    for await (const event of adapter.stream({ prompt: "stream" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "status", status: "running" });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", text: "Hel" },
        { type: "tool-call", name: "shell", input: { cmd: "pwd" } },
        { type: "tool-result", name: "shell", output: "done" },
        { type: "status", status: "completed" },
      ]),
    );
  });
});
