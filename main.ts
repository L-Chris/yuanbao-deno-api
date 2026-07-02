import {
  ApiError,
  type BaseChatConfig,
  BaseChatProvider,
  ChatApiServer,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatMessage,
  type ListModelsResponse,
  ModelFlagChatConfigStrategy,
  parseKeyValueBearer,
  type RequestContext,
} from "chat-base";
import { mergeMessages } from "./utils.ts";
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
    defaultModel: "gpt_175B_0404",
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
    input: {
      body: ChatCompletionRequest;
      messages: ChatMessage[];
      config: BaseChatConfig;
      context: RequestContext<YuanBao.Cookies>;
    },
  ): Promise<ChatCompletionChunk> {
    const config = toYuanBaoConfig(input.config);
    const messages = input.messages as OpenAI.Message[];
    const refs: YuanBao.Attachment[] = [];
    const newMessages = mergeMessages(config, messages, refs);
    const conversation = await createConversation({
      config,
      cookies: input.context.auth,
      messages: newMessages,
      urls: refs,
    });

    config.chat_id = conversation.id;
    try {
      return await createCompletion({
        config,
        cookies: input.context.auth,
        messages: newMessages,
      }) as ChatCompletionChunk;
    } finally {
      await removeConversation(conversation.id, input.context.auth);
    }
  }

  async createChatCompletionStream(
    input: {
      body: ChatCompletionRequest;
      messages: ChatMessage[];
      config: BaseChatConfig;
      context: RequestContext<YuanBao.Cookies>;
    },
  ): Promise<ReadableStream<Uint8Array>> {
    const config = toYuanBaoConfig(input.config);
    const messages = input.messages as OpenAI.Message[];
    const refs: YuanBao.Attachment[] = [];
    const newMessages = mergeMessages(config, messages, refs);
    const conversation = await createConversation({
      config,
      cookies: input.context.auth,
      messages: newMessages,
      urls: refs,
    });

    config.chat_id = conversation.id;
    return await createCompletionStream({
      config,
      cookies: input.context.auth,
      messages: newMessages,
    }, () => removeConversation(conversation.id, input.context.auth));
  }

  async listModels(
    context: RequestContext<YuanBao.Cookies>,
  ): Promise<ListModelsResponse> {
    const models = await getModels(context.auth);
    return { data: models };
  }
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

const server = new ChatApiServer({
  provider: new YuanBaoProvider(),
  root: "Hello World",
});

const port = parseInt(Deno.env.get("PORT") || "8000", 10);
server.listen({ hostname: "0.0.0.0", port });
