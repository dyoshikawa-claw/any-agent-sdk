import { adapterToAgent } from "./core/adapter.js";
import { AgentError } from "./core/errors.js";
import type { AnyAgent, CreateAgentOptions } from "./core/types.js";
import { createClaudeAgentAdapter } from "./providers/claude-agent/adapter.js";
import { createOpenCodeAdapter } from "./providers/opencode/adapter.js";

export const createAgent = (options: CreateAgentOptions): AnyAgent => {
  switch (options.provider) {
    case "opencode":
      return adapterToAgent(createOpenCodeAdapter(options));
    case "claude-agent":
      return adapterToAgent(createClaudeAgentAdapter(options));
    default: {
      const provider = String(options.provider);
      throw new AgentError("unsupported-provider", `Unsupported provider: ${provider}`, {
        details: { provider },
      });
    }
  }
};
