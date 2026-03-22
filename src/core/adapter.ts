import type { AgentRunInput, AgentRunResult, AgentEvent, AnyAgent } from "./types.js";

export type ProviderAdapter = {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
};

export const adapterToAgent = (adapter: ProviderAdapter): AnyAgent => {
  return {
    run: (input) => adapter.run(input),
    stream: (input) => adapter.stream(input),
  };
};
