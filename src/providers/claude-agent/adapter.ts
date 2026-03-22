import { AgentError } from "../../core/errors.js";
import type {
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  CreateAgentOptions,
} from "../../core/types.js";

export const createClaudeAgentAdapter = (
  options: CreateAgentOptions,
): {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
} => {
  const notImplemented = () =>
    new AgentError("not-implemented", "Claude Agent adapter is not implemented yet", {
      details: {
        provider: options.provider,
        model: options.model,
      },
    });

  return {
    async run(_input) {
      throw notImplemented();
    },
    stream(_input) {
      throw notImplemented();
    },
  };
};
