import {
  query,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { AgentError } from "../../core/errors.js";
import type {
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  CreateAgentOptions,
} from "../../core/types.js";

type ClaudeAgentProviderOptions = {
  query?: typeof query;
  options?: Options;
};

type ToolResultBlock = {
  type: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  error?: unknown;
};

type ToolUseBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  server_name?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isOptions = (value: unknown): value is Options => {
  return isRecord(value);
};

const isQueryFunction = (value: unknown): value is typeof query => {
  return typeof value === "function";
};

const isToolUseBlock = (block: unknown): block is ToolUseBlock => {
  if (!isRecord(block) || typeof block.type !== "string") {
    return false;
  }
  return (
    block.type === "tool_use" || block.type === "server_tool_use" || block.type === "mcp_tool_use"
  );
};

const isToolResultBlock = (block: unknown): block is ToolResultBlock => {
  if (!isRecord(block) || typeof block.type !== "string") {
    return false;
  }
  return (
    block.type === "tool_result" ||
    block.type === "mcp_tool_result" ||
    block.type.endsWith("_tool_result")
  );
};

const toProviderOptions = (options: CreateAgentOptions): ClaudeAgentProviderOptions => {
  const raw = options.providerOptions;
  if (!isRecord(raw)) {
    return {};
  }
  const result: ClaudeAgentProviderOptions = {};
  if (isQueryFunction(raw.query)) {
    result.query = raw.query;
  }
  if (isOptions(raw.options)) {
    result.options = raw.options;
  }
  return result;
};

const mapApprovalMode = (
  approvalMode?: AgentRunInput["approvalMode"],
): Options["permissionMode"] | undefined => {
  switch (approvalMode) {
    case "auto":
      return "acceptEdits";
    case "manual":
      return "default";
    case "default":
      return "default";
    default:
      return undefined;
  }
};

const buildPrompt = (input: AgentRunInput): string => {
  const contextText = input.context?.map((entry) => entry.text).filter(Boolean) ?? [];
  return [...contextText, input.prompt].join("\n\n");
};

const buildOptions = (
  input: AgentRunInput,
  options: CreateAgentOptions,
  providerOptions: ClaudeAgentProviderOptions,
  includePartialMessages: boolean,
): Options => {
  const merged: Options = providerOptions.options ? { ...providerOptions.options } : {};
  if (options.model) {
    merged.model = options.model;
  }
  const cwd = input.cwd ?? options.cwd ?? providerOptions.options?.cwd;
  if (cwd) {
    merged.cwd = cwd;
  }
  const permissionMode = mapApprovalMode(input.approvalMode) ?? merged.permissionMode;
  if (permissionMode) {
    merged.permissionMode = permissionMode;
  }
  if (input.maxTurns !== undefined) {
    merged.maxTurns = input.maxTurns;
  }
  if (input.system) {
    merged.systemPrompt = input.system;
  }
  if (includePartialMessages) {
    merged.includePartialMessages = true;
  }
  return merged;
};

const toUsage = (usage?: { input_tokens?: number; output_tokens?: number }) => {
  if (!usage) {
    return undefined;
  }
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
};

const collectToolName = (block: ToolUseBlock): string | undefined => {
  if (block.type === "mcp_tool_use") {
    if (block.server_name && block.name) {
      return `${block.server_name}.${block.name}`;
    }
  }
  return block.name;
};

const inferToolNameFromResult = (block: ToolResultBlock): string | undefined => {
  if (block.type.endsWith("_tool_result")) {
    return block.type.replace("_tool_result", "");
  }
  if (block.type === "mcp_tool_result") {
    return "mcp";
  }
  if (block.type === "tool_result") {
    return "tool";
  }
  return undefined;
};

const mapContentBlock = (
  block: unknown,
  toolUseNames: Map<string, string>,
  events: AgentEvent[],
  appendText: (text: string) => void,
): void => {
  if (!isRecord(block) || typeof block.type !== "string") {
    return;
  }
  if (block.type === "text" && typeof block.text === "string") {
    appendText(block.text);
    return;
  }
  if (isToolUseBlock(block)) {
    const name = collectToolName(block) ?? "tool";
    if (block.id) {
      toolUseNames.set(block.id, name);
    }
    events.push({ type: "tool-call", name, input: block.input ?? {} });
    return;
  }
  if (isToolResultBlock(block) && block.tool_use_id) {
    const name = toolUseNames.get(block.tool_use_id) ?? inferToolNameFromResult(block) ?? "tool";
    const output = "content" in block ? block.content : block;
    events.push({ type: "tool-result", name, output });
    if (block.is_error || block.error) {
      const errorText = String(block.error ?? `Claude Agent tool error: ${name}`);
      events.push({ type: "error", error: errorText });
    }
  }
};

const mapAssistantMessage = (
  message: { message?: { content?: unknown[] } | null; error?: string },
  toolUseNames: Map<string, string>,
  events: AgentEvent[],
  appendText: (text: string) => void,
): void => {
  if (message.error) {
    events.push({ type: "error", error: String(message.error) });
  }
  const content = message.message?.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    mapContentBlock(block, toolUseNames, events, appendText);
  }
};

const mapSystemMessageModel = (message: SDKMessage): string | undefined => {
  if (message.type !== "system") {
    return undefined;
  }
  if (message.subtype === "init" && "model" in message && typeof message.model === "string") {
    return message.model;
  }
  return undefined;
};

const isResultMessage = (message: SDKMessage): message is SDKResultMessage => {
  return message.type === "result";
};

export const createClaudeAgentAdapter = (
  options: CreateAgentOptions,
): {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
} => {
  const providerOptions = toProviderOptions(options);
  const queryFn = providerOptions.query ?? query;

  return {
    async run(input) {
      const prompt = buildPrompt(input);
      const queryOptions = buildOptions(input, options, providerOptions, false);
      const toolUseNames = new Map<string, string>();
      const events: AgentEvent[] = [];
      let text = "";
      let usage: AgentRunResult["usage"];
      let finishReason: string | undefined;
      let model = options.model;
      let rawResult: SDKResultMessage | undefined;

      const appendText = (chunk: string) => {
        if (!chunk) {
          return;
        }
        text += chunk;
        events.push({ type: "text", text: chunk });
      };

      try {
        for await (const message of queryFn({ prompt, options: queryOptions })) {
          if (message.type === "assistant") {
            mapAssistantMessage(message, toolUseNames, events, appendText);
          }
          if (message.type === "system") {
            model = mapSystemMessageModel(message) ?? model;
          }
          if (isResultMessage(message)) {
            rawResult = message;
            usage = toUsage(message.usage);
            finishReason = message.stop_reason ?? undefined;
            if (message.subtype !== "success") {
              for (const error of message.errors ?? []) {
                events.push({ type: "error", error: String(error) });
              }
            }
          }
        }
      } catch (error) {
        throw new AgentError("provider-error", "Claude Agent query failed", {
          cause: error,
          details: { provider: options.provider, model: options.model },
        });
      }

      return {
        provider: options.provider,
        model,
        text,
        events,
        usage,
        finishReason,
        raw: rawResult,
      };
    },
    async *stream(input) {
      const prompt = buildPrompt(input);
      const queryOptions = buildOptions(input, options, providerOptions, true);
      const toolUseNames = new Map<string, string>();
      const seenToolUses = new Set<string>();
      const seenToolResults = new Set<string>();
      let completed = false;
      let failed = false;

      const emitToolCall = (
        id: string | undefined,
        name: string,
        toolInput: unknown,
      ): AgentEvent | undefined => {
        if (id && seenToolUses.has(id)) {
          return;
        }
        if (id) {
          seenToolUses.add(id);
        }
        return { type: "tool-call", name, input: toolInput };
      };

      const emitToolResult = (
        id: string | undefined,
        name: string,
        output: unknown,
        isError?: boolean,
      ): AgentEvent[] => {
        if (id && seenToolResults.has(id)) {
          return [];
        }
        if (id) {
          seenToolResults.add(id);
        }
        const events: AgentEvent[] = [{ type: "tool-result", name, output }];
        if (isError) {
          events.push({ type: "error", error: `Claude Agent tool error: ${name}` });
        }
        return events;
      };

      const handleToolBlock = (block: ToolUseBlock) => {
        const name = collectToolName(block) ?? "tool";
        if (block.id) {
          toolUseNames.set(block.id, name);
        }
        return emitToolCall(block.id, name, block.input ?? {});
      };

      yield { type: "status", status: "running" };

      try {
        for await (const message of queryFn({ prompt, options: queryOptions })) {
          if (message.type === "stream_event") {
            const streamEvent = message.event;
            if (streamEvent.type === "content_block_start") {
              const block = streamEvent.content_block;
              if (isRecord(block)) {
                if (isToolUseBlock(block)) {
                  const toolEvent = handleToolBlock(block);
                  if (toolEvent) {
                    yield toolEvent;
                  }
                } else if (isToolResultBlock(block)) {
                  const toolResultBlock = block;
                  const name =
                    (toolResultBlock.tool_use_id
                      ? toolUseNames.get(toolResultBlock.tool_use_id)
                      : undefined) ??
                    inferToolNameFromResult(toolResultBlock) ??
                    "tool";
                  const output =
                    "content" in toolResultBlock ? toolResultBlock.content : toolResultBlock;
                  for (const event of emitToolResult(
                    toolResultBlock.tool_use_id,
                    name,
                    output,
                    toolResultBlock.is_error || Boolean(toolResultBlock.error),
                  )) {
                    yield event;
                  }
                }
              }
            }
            if (streamEvent.type === "content_block_delta") {
              if (streamEvent.delta.type === "text_delta") {
                yield { type: "text-delta", text: streamEvent.delta.text };
              }
            }
            if (streamEvent.type === "message_delta") {
              if (streamEvent.delta.stop_reason) {
                completed = true;
              }
            }
            continue;
          }
          if (message.type === "assistant") {
            const content = message.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (!isRecord(block) || typeof block.type !== "string") {
                  continue;
                }
                if (isToolUseBlock(block)) {
                  const toolEvent = handleToolBlock(block);
                  if (toolEvent) {
                    yield toolEvent;
                  }
                } else if (isToolResultBlock(block)) {
                  const toolResultBlock = block;
                  const name =
                    (toolResultBlock.tool_use_id
                      ? toolUseNames.get(toolResultBlock.tool_use_id)
                      : undefined) ??
                    inferToolNameFromResult(toolResultBlock) ??
                    "tool";
                  const output =
                    "content" in toolResultBlock ? toolResultBlock.content : toolResultBlock;
                  for (const event of emitToolResult(
                    toolResultBlock.tool_use_id,
                    name,
                    output,
                    toolResultBlock.is_error || Boolean(toolResultBlock.error),
                  )) {
                    yield event;
                  }
                }
              }
            }
            if (message.error) {
              yield { type: "error", error: String(message.error) };
              failed = true;
            }
          }
          if (isResultMessage(message)) {
            if (message.subtype !== "success") {
              for (const error of message.errors ?? []) {
                yield { type: "error", error: String(error) };
              }
              failed = true;
            } else {
              completed = true;
            }
          }
        }
      } catch (error) {
        yield { type: "error", error: String(error) };
        failed = true;
      }

      if (failed) {
        yield { type: "status", status: "failed" };
      } else if (completed) {
        yield { type: "status", status: "completed" };
      }
    },
  };
};
