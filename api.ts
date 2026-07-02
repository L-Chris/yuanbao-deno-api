import {
  BracketToolProtocol,
  buildJsonObjectPrompt,
  buildJsonSchemaPrompt,
  collectOpenAIStream,
  createChatCompletion,
  normalizeJsonSchema,
} from "chat-base";
import { extractJsonFromContent } from "./utils.ts";
import { OpenAI, YuanBao } from "./types.ts";
import { ChunkTransformer } from "./chunk-transformer.ts";

export async function createConversation(params: {
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
  messages: YuanBao.Message[];
  urls: YuanBao.Attachment[];
}) {
  const result = await fetch(
    "https://yuanbao.tencent.com/api/user/agent/conversation/create",
    {
      method: "POST",
      body: JSON.stringify({
        agentId: params.cookies.agentId,
      }),
      headers: generateHeaders(params.cookies),
    },
  );

  const json = await result.json();
  return {
    id: json.id,
  };
}

export async function removeConversation(
  convId: string,
  cookies: YuanBao.Cookies,
) {
  console.log("[yuanbao] removeConversation:", convId);
  const res = await fetch(
    `https://yuanbao.tencent.com/api/user/agent/conversation/v1/clear`,
    {
      method: "POST",
      headers: generateHeaders(cookies),
      body: JSON.stringify({
        conversationIds: [convId],
        uiOptions: {
          noToast: true,
        },
      }),
    },
  );
  console.log("[yuanbao] removeConversation response:", res.status);
}

export async function createCompletionStream(
  params: {
    messages: YuanBao.Message[];
    config: OpenAI.ChatConfig;
    cookies: YuanBao.Cookies;
  },
  callback = () => {},
) {
  const prompt = params.messages.reduce((pre, cur) => {
    if (Array.isArray(cur.content)) {
      return pre + cur.content.map((c) => c.text).join("\n");
    } else {
      return pre + cur.content;
    }
  }, "");
  const req = await fetch(
    `https://yuanbao.tencent.com/api/chat/${params.config.chat_id}`,
    {
      method: "POST",
      headers: {
        ...generateHeaders(params.cookies),
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "gpt_175B_0404",
        prompt: prompt,
        plugin: "Adaptive",
        displayPrompt: prompt,
        displayPromptType: 1,
        options: {
          imageIntention: {
            needIntentionModel: true,
            backendUpdateFlag: 2,
            intentionStatus: true,
          },
        },
        multimedia: [],
        agentId: params.cookies.agentId,
        supportHint: 1,
        version: "v2",
        chatModelId: params.config.model_name,
        supportFunctions: [
          params.config.features.searching
            ? "supportInternetSearch"
            : "closeInternetSearch",
        ],
        ...(params.config.features.deepsearching
          ? {
            isAiDeepSearch: true,
            searchDeepMode: true,
            searchDeepModeParentCid: params.config.chat_id,
            searchDeepModeParentIndex: 2,
            searchDeepModeParentRepeatIndex: 0,
            speechMode: 5,
          }
          : {}),
      }),
    },
  );

  const parser = new ChunkTransformer(req, params.config, params.messages);

  parser.onDone(callback);

  return parser.getStream();
}

export async function createCompletion(params: {
  messages: YuanBao.Message[];
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  const config = params.config;
  const isJson = params.config.response_format.type === "json_schema";
  const lastMessage = params.messages.findLast((_) => _.role === "user")!;

  if (isJson) {
    const schema = normalizeJsonSchema(params.config.response_format);
    const schemaPrompt = schema
      ? buildJsonSchemaPrompt(schema)
      : buildJsonObjectPrompt();

    lastMessage.content = `${
      Array.isArray(lastMessage.content)
        ? lastMessage.content[0].text
        : lastMessage.content
    }${schemaPrompt}`;
  }

  const prompt = params.messages.reduce((pre, cur) => {
    if (Array.isArray(cur.content)) {
      return pre + cur.content.map((c) => c.text).join("\n");
    } else {
      return pre + cur.content;
    }
  }, "");

  const req = await fetch(
    `https://yuanbao.tencent.com/api/chat/${config.chat_id}`,
    {
      method: "POST",
      headers: {
        ...generateHeaders(params.cookies),
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "gpt_175B_0404",
        prompt: prompt,
        plugin: "Adaptive",
        displayPrompt: prompt,
        displayPromptType: 1,
        options: {
          imageIntention: {
            needIntentionModel: true,
            backendUpdateFlag: 2,
            intentionStatus: true,
          },
        },
        multimedia: [],
        agentId: params.cookies.agentId,
        supportHint: 1,
        version: "v2",
        chatModelId: config.model_name,
        supportFunctions: [
          config.features.searching
            ? "supportInternetSearch"
            : "closeInternetSearch",
        ],
        ...(config.features.deepsearching
          ? {
            isAiDeepSearch: true,
            searchDeepMode: true,
            searchDeepModeParentCid: config.chat_id,
            searchDeepModeParentIndex: 2,
            searchDeepModeParentRepeatIndex: 0,
            speechMode: 5,
          }
          : {}),
      }),
    },
  );

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.indexOf("text/event-stream") < 0) {
    const text = await req.text();
    throw new Error(
      contentType.includes("text/html")
        ? "rejected by server"
        : text || req.statusText,
    );
  }

  const parser = new ChunkTransformer(req, config, params.messages);
  const stream = parser.getStream();
  const collected = await collectOpenAIStream(stream, {
    model: config.model_name,
  });
  const message = createChatCompletion({
    id: collected.id,
    model: config.model_name,
    content: collected.content,
    reasoningContent: collected.reasoningContent,
    toolCalls: collected.toolCalls,
    finishReason: collected.finishReason,
    citations: collected.citations,
    created: collected.created,
    usage: collected.usage ?? {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  });
  return formatMessageResponse(message, config.response_format, config.tools);
}

export async function getModels(cookies: YuanBao.Cookies) {
  return [
    {
      id: "deep_seek",
      name: "deepseek",
    },
    {
      id: "deep_seek_search",
      name: "deepseek_search",
    },
    {
      id: "deep_seek_think_search",
      name: "deepseek_think_search",
    },
    {
      id: "gpt_175B_0404_deepsearch",
      name: "hunyuan_deepsearch",
    },
    {
      id: "gpt_175B_0404",
      name: "hunyuan",
    },
    {
      id: "hunyuan_t1_think",
      name: "hunyuan_think",
    },
    {
      id: "hunyuan_t1_think_search",
      name: "hunyuan_think_search",
    },
    {
      id: "gpt_175B_0404_search",
      name: "hunyuan_search",
    },
  ];
}

function formatMessageResponse(
  message: OpenAI.CompletionChunk,
  response_format?: OpenAI.ChatConfig["response_format"],
  tools?: OpenAI.Tool[],
) {
  if (!message.choices[0].message) return message;
  const content = message.choices[0].message.content ?? "";

  if (response_format?.type === "json_schema") {
    const json = extractJsonFromContent(content);
    if (json) {
      message.choices[0].message.content = JSON.stringify(json);
    }
  }

  if (!tools?.length) return message;
  const { cleanContent, toolCalls } = new BracketToolProtocol().parse(
    message.choices[0].message.content ?? "",
  );
  message.choices[0].message.content = cleanContent;
  message.choices[0].message.tool_calls = toolCalls;

  return message;
}

export function generateHeaders(cookies: YuanBao.Cookies) {
  const Cookie = [
    `hy_source=web`,
    `hy_user=${cookies.hy_user}`,
    `hy_token=${cookies.token}`,
  ].join("; ");

  return {
    Cookie,
    "chat_version": "v1",
    "x-agentid": cookies.agentId,
    "x-id": cookies.hy_user,
    "t-userid": cookies.hy_user,
    "x-requested-with": "XMLHttpRequest",
    "x-source": "web",
    "x-platform": "win",
    "x-language": "zh-CN",
    "x-webversion": "2.68.1",
    "x-instance-id": "5",
    "x-ybuitest": "0",
    "x-webdriver": "0",
    "x-web-third-source": "main",
    "x-os-version": "Windows(10)-Blink",
    "content-type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "no-cache",
    Origin: "https://yuanbao.tencent.com",
    Pragma: "no-cache",
    "Sec-Ch-Ua":
      '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Referer: "https://yuanbao.tencent.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  };
}
