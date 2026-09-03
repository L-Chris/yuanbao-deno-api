import {
  ApiError,
  type BaseChatConfig,
  BaseChatProvider,
  ChatApiServer,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatRunInput,
  type ListModelsResponse,
  mergeMessages,
  ModelFlagChatConfigStrategy,
  parseKeyValueBearer,
  type RequestContext,
  runConversationCompletion,
  runConversationStream,
} from "chat-base";
import {
  createCompletion,
  createCompletionStream,
  createConversation,
  getModels,
  removeConversation,
} from "./api.ts";
import { OpenAI, YuanBao } from "./types.ts";

class YuanBaoProvider extends BaseChatProvider<YuanBao.Cookies> {
  readonly name = "yuanbao";

  private readonly configStrategy = new ModelFlagChatConfigStrategy({
    defaultModel: "hunyuan_gpt_175B_0404",
    separator: "_",
    modelNameFilter: (parts) =>
      parts.filter((part) => !["think", "search"].includes(part)).join("_"),
  });

  authenticate(headers: Headers): YuanBao.Cookies {
    const auth = parseKeyValueBearer(headers.get("authorization"));
    if (!auth.token) {
      throw new ApiError("need token", {
        status: 401,
        type: "authentication_error",
        code: "missing_token",
      });
    }

    return {
      token: auth.token,
      agentId: auth.agentId,
      hy_user: auth.hy_user,
      requestHeaders: getYuanBaoRequestHeaders(headers),
    };
  }

  buildConfig(body: ChatCompletionRequest): BaseChatConfig {
    return this.configStrategy.build({
      chatId: body.id as string | undefined,
      model: body.model,
      stream: body.stream,
      responseFormat: body.response_format,
      tools: body.tools,
      toolChoice: body.tool_choice,
      messages: body.messages,
    });
  }

  async createChatCompletion(
    input: ChatRunInput<YuanBao.Cookies>,
  ): Promise<ChatCompletionChunk> {
    const config = toYuanBaoConfig(input.config);
    const messages = input.messages as OpenAI.Message[];
    const refs: YuanBao.Attachment[] = [];
    const newMessages = toYuanBaoMessages(config, messages, refs);

    return await runConversationCompletion({
      createConversation: () =>
        createConversation({
          config,
          cookies: input.context.auth,
          messages: newMessages,
          urls: refs,
        }),
      cleanupConversation: async (conversation) => {
        await removeConversation(conversation.id, input.context.auth);
      },
      createCompletion: async (conversation) => {
        config.chat_id = conversation.id;
        return await createCompletion({
          config,
          cookies: input.context.auth,
          messages: newMessages,
        }) as ChatCompletionChunk;
      },
    });
  }

  async createChatCompletionStream(
    input: ChatRunInput<YuanBao.Cookies>,
  ): Promise<ReadableStream<Uint8Array>> {
    const config = toYuanBaoConfig(input.config);
    const messages = input.messages as OpenAI.Message[];
    const refs: YuanBao.Attachment[] = [];
    const newMessages = toYuanBaoMessages(config, messages, refs);

    return await runConversationStream({
      createConversation: () =>
        createConversation({
          config,
          cookies: input.context.auth,
          messages: newMessages,
          urls: refs,
        }),
      cleanupConversation: async (conversation) => {
        await removeConversation(conversation.id, input.context.auth);
      },
      createStream: async (conversation) => {
        config.chat_id = conversation.id;
        return await createCompletionStream({
          config,
          cookies: input.context.auth,
          messages: newMessages,
        });
      },
    });
  }

  async listModels(
    context: RequestContext<YuanBao.Cookies>,
  ): Promise<ListModelsResponse> {
    const models = await getModels(context.auth);
    return { data: models };
  }
}

const YUANBAO_HEADER_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["x-yuanbao-uskey", "X-Uskey"],
  ["x-uskey", "X-Uskey"],
  ["x-yuanbao-bus-params-md5", "X-Bus-Params-Md5"],
  ["x-bus-params-md5", "X-Bus-Params-Md5"],
  ["x-yuanbao-timestamp", "X-Timestamp"],
  ["x-timestamp", "X-Timestamp"],
  ["x-yuanbao-device-id", "X-device-id"],
  ["x-device-id", "X-device-id"],
  ["x-yuanbao-hy92", "X-HY92"],
  ["x-hy92", "X-HY92"],
  ["x-yuanbao-hy93", "X-HY93"],
  ["x-hy93", "X-HY93"],
  ["x-yuanbao-exp-params", "X-Exp-Params"],
  ["x-exp-params", "X-Exp-Params"],
  ["x-yuanbao-trid-channel", "X-Trid-Channel"],
  ["x-trid-channel", "X-Trid-Channel"],
  ["x-yuanbao-web-ch-id", "x-web-ch-id"],
  ["x-web-ch-id", "x-web-ch-id"],
];

function getYuanBaoRequestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [source, target] of YUANBAO_HEADER_ALIASES) {
    if (result[target]) continue;
    const value = headers.get(source);
    if (value) result[target] = value;
  }

  return result;
}

function toYuanBaoConfig(config: BaseChatConfig): OpenAI.ChatConfig {
  return {
    chat_id: config.chatId,
    chat_type: config.chatType,
    model_name: config.modelName,
    response_format: config
      .responseFormat as OpenAI.ChatConfig["response_format"],
    features: {
      thinking: !!config.features.thinking,
      searching: !!config.features.searching,
      deepsearching: !!config.features.deepsearching,
    },
    stream: config.stream,
    tools: config.tools as OpenAI.Tool[],
    tool_choice: config.toolChoice as OpenAI.ToolChoice,
    is_tool_calling: config.isToolCalling,
    is_tool_calling_done: config.isToolCallingDone,
  };
}

function toYuanBaoMessages(
  config: OpenAI.ChatConfig,
  messages: OpenAI.Message[],
  refs: YuanBao.Attachment[],
): YuanBao.Message[] {
  return mergeMessages<YuanBao.Attachment, YuanBao.Message>(messages, {
    attachments: refs,
    tools: config.tools,
    toolChoice: config.tool_choice,
    toolPromptMode: "when-missing-system",
    buildUserContent: (content, attachments) => [
      { type: "text", text: content },
      ...attachments.map((item) => ({
        type: item.type,
        image: item.id,
      })),
    ],
  });
}

const server = new ChatApiServer({
  provider: new YuanBaoProvider(),
  root: "Hello World",
});

const port = parseInt(Deno.env.get("PORT") || "8000", 10);
server.listen({ hostname: "0.0.0.0", port });
