import { describe, it, expect } from "vitest";

import { AgentError } from "./core/errors.js";
import { createAgent } from "./create-agent.js";

describe("createAgent", () => {
  it("returns an agent with run/stream", () => {
    const agent = createAgent({ provider: "opencode" });

    expect(agent.run).toBeTypeOf("function");
    expect(agent.stream).toBeTypeOf("function");
  });

  it("rejects unsupported providers", () => {
    expect(() => createAgent({ provider: "unknown" as "opencode" })).toThrow(AgentError);
  });
});
