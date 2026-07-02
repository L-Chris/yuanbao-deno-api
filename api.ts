import { appendJsonSchemaPrompt, ProviderApiClient } from "chat-base";
import { OpenAI, YuanBao } from "./types.ts";
import { ChunkTransformer } from "./chunk-transformer.ts";

const apiClient = new ProviderApiClient({ name: "yuanbao" });

const REQUEST_URL = {
  CREATE_CONVERSATION:
    "https://yuanbao.tencent.com/api/user/agent/conversation/create",
  REMOVE_CONVERSATION:
    "https://yuanbao.tencent.com/api/user/agent/conversation/v1/clear",
  CREATE_COMPLETION: (chatId: string) =>
    `https://yuanbao.tencent.com/api/chat/${chatId}`,
};

export async function createConversation(params: {
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
  messages: YuanBao.Message[];
  urls: YuanBao.Attachment[];
}) {
  const json = await apiClient.json<{ id: string }>({
    url: REQUEST_URL.CREATE_CONVERSATION,
    init: {
      method: "POST",
      body: JSON.stringify({
        agentId: params.cookies.agentId,
      }),
      headers: generateHeaders(params.cookies),
    },
  });

  return {
    id: json.id,
  };
}

export async function removeConversation(
  convId: string,
  cookies: YuanBao.Cookies,
) {
  console.log("[yuanbao] removeConversation:", convId);
  const res = await apiClient.request({
    url: REQUEST_URL.REMOVE_CONVERSATION,
    init: {
      method: "POST",
      headers: generateHeaders(cookies),
      body: JSON.stringify({
        conversationIds: [convId],
        uiOptions: {
          noToast: true,
        },
      }),
    },
  });
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
  return await apiClient.createCompletionStream({
    request: buildCompletionRequest(params),
    createTransformer: (response) =>
      new ChunkTransformer(response, params.config, params.messages),
    onDone: callback,
  });
}

export async function createCompletion(params: {
  messages: YuanBao.Message[];
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  const messages = appendJsonSchemaPrompt(
    params.messages,
    params.config.response_format,
  ) as YuanBao.Message[];

  return await apiClient.createCompletion({
    request: buildCompletionRequest({ ...params, messages }),
    model: params.config.model_name,
    messages,
    responseFormat: params.config.response_format,
    tools: params.config.tools,
    createTransformer: (response) =>
      new ChunkTransformer(response, params.config, messages),
  });
}

function buildCompletionRequest(params: {
  messages: YuanBao.Message[];
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  const prompt = messagesToPrompt(params.messages);

  return {
    url: REQUEST_URL.CREATE_COMPLETION(params.config.chat_id),
    init: {
      method: "POST",
      headers: {
        ...generateHeaders(params.cookies),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(buildCompletionBody({
        prompt,
        config: params.config,
        cookies: params.cookies,
      })),
    },
  };
}

function buildCompletionBody(params: {
  prompt: string;
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  const { prompt, config, cookies } = params;

  return {
    model: "gpt_175B_0404",
    prompt,
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
    agentId: cookies.agentId,
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
  };
}

function messagesToPrompt(messages: YuanBao.Message[]): string {
  return messages.reduce(
    (previous, current) =>
      previous +
      (Array.isArray(current.content)
        ? current.content.map((item) => item.text ?? "").join("\n")
        : current.content),
    "",
  );
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
