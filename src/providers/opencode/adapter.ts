import {
  createOpencodeClient,
  type OpencodeClient,
  type Part,
  type AssistantMessage,
  type ToolPart,
  type TextPart,
} from "@opencode-ai/sdk";

import { AgentError } from "../../core/errors.js";
import type {
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  CreateAgentOptions,
} from "../../core/types.js";

type OpenCodeRequestOptions = {
  query?: {
    directory?: string;
  };
} & Record<string, unknown>;

type OpenCodeProviderOptions = {
  client?: OpencodeClient;
  clientConfig?: Parameters<typeof createOpencodeClient>[0];
  requestOptions?: OpenCodeRequestOptions;
  modelProviderId?: string;
  agent?: string;
  sessionId?: string;
  continueSession?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isOpencodeClient = (value: unknown): value is OpencodeClient => {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value.session)) {
    return false;
  }
  const session = value.session;
  const hasSessionMethods = "create" in session && "prompt" in session && "promptAsync" in session;
  const hasEvent = value.event === undefined || isRecord(value.event);
  return hasSessionMethods && hasEvent;
};

const toProviderOptions = (options: CreateAgentOptions): OpenCodeProviderOptions => {
  const raw = options.providerOptions;
  if (!isRecord(raw)) {
    return {};
  }
  const result: OpenCodeProviderOptions = {};
  if (isOpencodeClient(raw.client)) {
    result.client = raw.client;
  }
  if (isRecord(raw.clientConfig)) {
    result.clientConfig = raw.clientConfig;
  }
  if (isRecord(raw.requestOptions)) {
    result.requestOptions = raw.requestOptions;
  }
  if (typeof raw.modelProviderId === "string") {
    result.modelProviderId = raw.modelProviderId;
  }
  if (typeof raw.agent === "string") {
    result.agent = raw.agent;
  }
  if (typeof raw.sessionId === "string") {
    result.sessionId = raw.sessionId;
  }
  if (typeof raw.continueSession === "boolean") {
    result.continueSession = raw.continueSession;
  }
  return result;
};

const resolveDirectory = (
  input: AgentRunInput,
  options: CreateAgentOptions,
  providerOptions: OpenCodeProviderOptions,
): string | undefined => {
  return input.cwd ?? options.cwd ?? providerOptions.requestOptions?.query?.directory;
};

const resolveSessionId = (providerOptions: OpenCodeProviderOptions): string | undefined => {
  if (providerOptions.continueSession && providerOptions.sessionId) {
    return providerOptions.sessionId;
  }
  return undefined;
};

const buildModel = (
  options: CreateAgentOptions,
  providerOptions: OpenCodeProviderOptions,
): { providerID: string; modelID: string } | undefined => {
  if (!options.model) {
    return undefined;
  }
  const parts = options.model.split("/");
  if (parts.length >= 2) {
    const [providerID, ...rest] = parts;
    const modelID = rest.join("/");
    if (providerID && modelID) {
      return { providerID, modelID };
    }
  }
  if (providerOptions.modelProviderId) {
    return { providerID: providerOptions.modelProviderId, modelID: options.model };
  }
  return undefined;
};

const toTextParts = (input: AgentRunInput): Array<{ type: "text"; text: string }> => {
  const contextParts: Array<{ type: "text"; text: string }> =
    input.context?.map((entry) => ({
      type: "text",
      text: entry.text,
    })) ?? [];
  return [...contextParts, { type: "text", text: input.prompt }];
};

const mergeRequestOptions = (
  requestOptions: OpenCodeRequestOptions,
  directory?: string,
): OpenCodeRequestOptions => {
  const { body: _body, path: _path, ...rest } = requestOptions;
  return {
    ...rest,
    query: {
      ...requestOptions.query,
      ...(directory ? { directory } : {}),
    },
  };
};

const collectText = (parts: Part[]): string => {
  return parts
    .filter((part): part is TextPart => part.type === "text")
    .filter((part) => !part.ignored)
    .map((part) => part.text)
    .join("");
};

const mapToolPartToEvents = (part: ToolPart, includeCompletedCall: boolean): AgentEvent[] => {
  const events: AgentEvent[] = [];
  const input = part.state.input ?? {};
  if (part.state.status === "pending" || part.state.status === "running") {
    events.push({ type: "tool-call", name: part.tool, input });
  }
  if (part.state.status === "completed") {
    if (includeCompletedCall) {
      events.push({ type: "tool-call", name: part.tool, input });
    }
    events.push({ type: "tool-result", name: part.tool, output: part.state.output });
  }
  if (part.state.status === "error") {
    if (includeCompletedCall) {
      events.push({ type: "tool-call", name: part.tool, input });
    }
    const errorText = String(part.state.error ?? "Unknown tool error");
    events.push({
      type: "tool-result",
      name: part.tool,
      output: { error: errorText },
    });
    events.push({ type: "error", error: errorText });
  }
  return events;
};

const mapPartsToEvents = (parts: Part[]): AgentEvent[] => {
  const events: AgentEvent[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.ignored) {
        continue;
      }
      events.push({ type: "text", text: part.text });
    }
    if (part.type === "tool") {
      events.push(...mapToolPartToEvents(part, true));
    }
  }
  return events;
};

const buildUsage = (info?: AssistantMessage): AgentRunResult["usage"] => {
  if (!info?.tokens) {
    return undefined;
  }
  const inputTokens = info.tokens.input ?? 0;
  const outputTokens = info.tokens.output ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
};

const assertResponseData = <T>(
  label: string,
  response: { data?: T; error?: unknown },
  details: Record<string, unknown>,
): T => {
  if (!response.data) {
    throw new AgentError("provider-error", `OpenCode ${label} failed`, {
      cause: response.error,
      details,
    });
  }
  return response.data;
};

export const createOpenCodeAdapter = (
  options: CreateAgentOptions,
): {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  stream(input: AgentRunInput): AsyncIterable<AgentEvent>;
} => {
  const providerOptions = toProviderOptions(options);
  const clientConfig = {
    ...providerOptions.clientConfig,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.cwd ? { directory: options.cwd } : {}),
  };
  const client = providerOptions.client ?? createOpencodeClient(clientConfig);

  return {
    async run(input) {
      const directory = resolveDirectory(input, options, providerOptions);
      const requestOptions = mergeRequestOptions(providerOptions.requestOptions ?? {}, directory);
      const existingSessionId = resolveSessionId(providerOptions);
      const sessionInfo: { id: string } = existingSessionId
        ? { id: existingSessionId }
        : assertResponseData("session.create", await client.session.create(requestOptions), {
            provider: options.provider,
            model: options.model,
          });

      const model = buildModel(options, providerOptions);
      const parts = toTextParts(input);
      const promptResult = await client.session.prompt({
        ...requestOptions,
        path: { id: sessionInfo.id },
        body: {
          parts,
          system: input.system,
          model,
          agent: providerOptions.agent,
        },
      });
      const promptData = assertResponseData("session.prompt", promptResult, {
        provider: options.provider,
        model: options.model,
        sessionId: sessionInfo.id,
      });

      const text = collectText(promptData.parts);
      const events = mapPartsToEvents(promptData.parts);
      const modelId = promptData.info
        ? `${promptData.info.providerID}/${promptData.info.modelID}`
        : options.model;
      const usage = buildUsage(promptData.info);
      const finishReason = promptData.info?.finish;

      if (promptData.info?.error) {
        const errorText = String(
          promptData.info.error.data?.message ?? "OpenCode reported an error",
        );
        events.push({
          type: "error",
          error: errorText,
        });
      }

      return {
        provider: options.provider,
        model: modelId,
        text,
        events,
        usage,
        finishReason,
        raw: promptData,
      };
    },
    async *stream(input) {
      const directory = resolveDirectory(input, options, providerOptions);
      const requestOptions = mergeRequestOptions(providerOptions.requestOptions ?? {}, directory);
      const existingSessionId = resolveSessionId(providerOptions);
      const sessionInfo: { id: string } = existingSessionId
        ? { id: existingSessionId }
        : assertResponseData("session.create", await client.session.create(requestOptions), {
            provider: options.provider,
            model: options.model,
          });
      const sessionId = sessionInfo.id;

      yield { type: "status", status: "running" };

      if (typeof client.event?.subscribe !== "function") {
        const result = await this.run(input);
        for (const event of result.events) {
          if (event.type !== "status") {
            yield event;
          }
        }
        yield { type: "status", status: "completed" };
        return;
      }

      const subscription = await client.event.subscribe(requestOptions);
      const model = buildModel(options, providerOptions);
      const parts = toTextParts(input);
      const promptAsyncResult = await client.session.promptAsync({
        ...requestOptions,
        path: { id: sessionId },
        body: {
          parts,
          system: input.system,
          model,
          agent: providerOptions.agent,
        },
      });
      if ("error" in promptAsyncResult && promptAsyncResult.error) {
        throw new AgentError("provider-error", "OpenCode session.promptAsync failed", {
          cause: promptAsyncResult.error,
          details: { provider: options.provider, model: options.model, sessionId },
        });
      }

      const seenToolCalls = new Set<string>();
      let completed = false;
      let failed = false;

      const { stream } = subscription;
      for await (const event of stream) {
        if (event.type === "session.error") {
          if (!event.properties.sessionID || event.properties.sessionID === sessionId) {
            yield {
              type: "error",
              error: String(
                event.properties.error?.data?.message ?? "OpenCode reported a session error",
              ),
            };
            failed = true;
            break;
          }
        }
        if (event.type === "message.updated") {
          if (
            event.properties.info.role === "assistant" &&
            event.properties.info.sessionID === sessionId &&
            event.properties.info.error
          ) {
            yield {
              type: "error",
              error: String(
                event.properties.info.error.data?.message ?? "OpenCode reported a message error",
              ),
            };
            failed = true;
            break;
          }
        }
        if (event.type !== "message.part.updated") {
          continue;
        }
        const part = event.properties.part;
        if (part.sessionID !== sessionId) {
          continue;
        }
        if (part.type === "text") {
          if (part.ignored) {
            continue;
          }
          if (event.properties.delta) {
            yield { type: "text-delta", text: event.properties.delta };
          } else {
            yield { type: "text", text: part.text };
          }
        }
        if (part.type === "tool") {
          const callKey = part.callID ?? part.id;
          if (
            (part.state.status === "pending" || part.state.status === "running") &&
            !seenToolCalls.has(callKey)
          ) {
            seenToolCalls.add(callKey);
            yield { type: "tool-call", name: part.tool, input: part.state.input ?? {} };
          }
          if (part.state.status === "completed") {
            if (!seenToolCalls.has(callKey)) {
              seenToolCalls.add(callKey);
              yield { type: "tool-call", name: part.tool, input: part.state.input ?? {} };
            }
            yield { type: "tool-result", name: part.tool, output: part.state.output };
          }
          if (part.state.status === "error") {
            if (!seenToolCalls.has(callKey)) {
              seenToolCalls.add(callKey);
              yield { type: "tool-call", name: part.tool, input: part.state.input ?? {} };
            }
            const errorText = String(part.state.error ?? "Unknown tool error");
            yield {
              type: "tool-result",
              name: part.tool,
              output: { error: errorText },
            };
            yield { type: "error", error: errorText };
            failed = true;
            break;
          }
        }
        if (part.type === "step-finish") {
          completed = true;
          break;
        }
      }

      if (failed) {
        yield { type: "status", status: "failed" };
        return;
      }
      if (completed) {
        yield { type: "status", status: "completed" };
      }
    },
  };
};
