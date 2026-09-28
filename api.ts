import {
  appendJsonSchemaPrompt,
  type ChatCompletionChunk,
  normalizeJsonSchema,
  ProviderApiClient,
} from "chat-base";
import md5 from "md5";
import { OpenAI, YuanBao, YuanBaoApiResponse } from "./types.ts";
import { ChunkTransformer } from "./chunk-transformer.ts";
import { UskeySigner } from "./signer.ts";

const apiClient = new ProviderApiClient({ name: "yuanbao" });

const WEB_VERSION = Deno.env.get("YUANBAO_WEB_VERSION") ?? "2.83.11";
const COMMIT_TAG = Deno.env.get("YUANBAO_COMMIT_TAG") ?? "0d2b8477";
const TIMEZONE_OFFSET_MINUTES = parseInt(
  Deno.env.get("YUANBAO_TIMEZONE_OFFSET_MINUTES") ?? "480",
  10,
);
const BROWSERLESS_URL = Deno.env.get("YUANBAO_BROWSERLESS_WS") ?? "";

const REQUEST_URL = {
  CREATE_CONVERSATION:
    "https://yuanbao.tencent.com/api/user/agent/conversation/create",
  REMOVE_CONVERSATION:
    "https://yuanbao.tencent.com/api/user/agent/conversation/v1/clear",
  CREATE_COMPLETION: (chatId: string) =>
    `https://yuanbao.tencent.com/api/chat/${chatId}`,
};

const SIGNING_PATHS = ["/user/agent/conversation/create", "/chat/"];

const signerCache = new Map<string, UskeySigner>();

function needsSigning(path: string): boolean {
  return SIGNING_PATHS.some((item) => path.includes(item));
}

async function getSecurityHeaders(
  cookies: YuanBao.Cookies,
  path: string,
): Promise<Record<string, string>> {
  if (!BROWSERLESS_URL || !needsSigning(path)) return {};

  let signer = signerCache.get(cookies.token);
  if (!signer) {
    if (signerCache.size >= 4) {
      const oldest = signerCache.entries().next().value;
      if (oldest) {
        signerCache.delete(oldest[0]);
        oldest[1].dispose();
      }
    }
    signer = new UskeySigner(BROWSERLESS_URL, cookies.agentId, [
      { name: "hy_source", value: "web" },
      { name: "hy_user", value: cookies.hy_user },
      { name: "hy_token", value: cookies.token },
    ]);
    signerCache.set(cookies.token, signer);
    console.log("[yuanbao] creating uskey signer session (first request is slow)");
  }

  try {
    const headers = await signer.sign();
    return headers ?? {};
  } catch (error) {
    console.error(
      "[yuanbao] uskey signing failed:",
      error instanceof Error ? error.message : error,
    );
    signerCache.delete(cookies.token);
    signer.dispose();
    return {};
  }
}

export async function createConversation(params: {
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
  messages: YuanBao.Message[];
  urls: YuanBao.Attachment[];
}) {
  const json = await apiClient.json<
    YuanBaoApiResponse<{ id?: string }> & { id?: string }
  >({
    url: REQUEST_URL.CREATE_CONVERSATION,
    init: {
      method: "POST",
      body: JSON.stringify({
        agentId: params.cookies.agentId,
      }),
      headers: await generateHeaders(
        params.cookies,
        await getSecurityHeaders(
          params.cookies,
          "/api/user/agent/conversation/create",
        ),
      ),
    },
  });

  const id = json.id ?? json.data?.id;
  if (!id) {
    const code = json.code ?? "unknown";
    const message = json.message ?? json.msg ?? "empty conversation id";
    throw new Error(`createConversation failed: ${code} ${message}`);
  }

  return {
    id,
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

  const response = await apiClient.createCompletion({
    request: buildCompletionRequest({ ...params, messages }),
    model: params.config.model_name,
    messages,
    responseFormat: params.config.response_format,
    tools: params.config.tools,
    createTransformer: (response) =>
      new ChunkTransformer(response, params.config, messages),
  });

  return await ensureJsonResponse({ ...params, messages }, response);
}

function isJsonFormatRequested(config: OpenAI.ChatConfig): boolean {
  const type = config.response_format?.type;
  return type === "json_schema" || type === "json_object";
}

function contentIsValidJson(content: unknown): content is string {
  if (typeof content !== "string" || !content.trim()) return false;
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function buildStructuringPrompt(config: OpenAI.ChatConfig): string {
  const schema = normalizeJsonSchema(config.response_format);
  if (schema) {
    return `你的上一条回答需要整理为 JSON。请严格按照以下 JSON Schema 整理上一条回答的内容，只输出符合该 Schema 的 JSON 数据本身，不要输出任何 Markdown、代码块标记或额外说明文字，也不要包含 Schema 定义本身：\n${
      JSON.stringify(schema, null, 2)
    }`;
  }
  return "请把上一条回答的内容整理为一个有效的 JSON 对象。只输出 JSON 本身，不要输出任何 Markdown、代码块标记或额外说明文字。";
}

async function ensureJsonResponse(
  params: {
    messages: YuanBao.Message[];
    config: OpenAI.ChatConfig;
    cookies: YuanBao.Cookies;
  },
  response: ChatCompletionChunk,
): Promise<ChatCompletionChunk> {
  const choice = response.choices?.[0];
  if (
    !isJsonFormatRequested(params.config) ||
    params.config.tools?.length ||
    contentIsValidJson(choice?.message?.content)
  ) {
    return response;
  }

  console.log(
    "[yuanbao] response is not valid JSON, sending structuring follow-up",
  );

  const followUpConfig = {
    ...params.config,
    features: {
      ...params.config.features,
      searching: false,
      deepsearching: false,
    },
  };
  const followUp = await apiClient.createCompletion({
    request: await buildCompletionRequestWithPrompt(
      { ...params, config: followUpConfig },
      buildStructuringPrompt(params.config),
    ),
    model: params.config.model_name,
    messages: params.messages,
    responseFormat: params.config.response_format,
    createTransformer: (response) =>
      new ChunkTransformer(response, followUpConfig, params.messages),
  });

  const followUpContent = followUp.choices?.[0]?.message?.content;
  const message = response.choices?.[0]?.message;
  if (contentIsValidJson(followUpContent) && message) {
    message.content = followUpContent;
    return response;
  }

  console.warn("[yuanbao] structuring follow-up did not return valid JSON");
  return response;
}

async function buildCompletionRequest(params: {
  messages: YuanBao.Message[];
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  return await buildCompletionRequestWithPrompt(
    params,
    messagesToPrompt(params.messages),
  );
}

async function buildCompletionRequestWithPrompt(
  params: {
    messages: YuanBao.Message[];
    config: OpenAI.ChatConfig;
    cookies: YuanBao.Cookies;
  },
  prompt: string,
) {
  const security = await getSecurityHeaders(
    params.cookies,
    `/api/chat/${params.config.chat_id}`,
  );

  return {
    url: REQUEST_URL.CREATE_COMPLETION(params.config.chat_id),
    init: {
      method: "POST",
      headers: {
        ...generateHeaders(params.cookies, security),
        Accept: "text/event-stream",
        "X-Input-Type": "text",
        "X-Event-Input-Type": "11",
        "X-Traceparent": crypto.randomUUID().replaceAll("-", ""),
      },
      body: JSON.stringify(buildCompletionBody({
        prompt,
        config: params.config,
        cookies: params.cookies,
      })),
    },
  };
}

export function buildCompletionBody(params: {
  prompt: string;
  config: OpenAI.ChatConfig;
  cookies: YuanBao.Cookies;
}) {
  const { prompt, config, cookies } = params;
  const internetSearch = config.features.searching
    ? "openInternetSearch"
    : "autoInternetSearch";
  const isHunyuanAgentMode = config.model_name === "hunyuan_t1";
  const chatModelExtInfo = {
    modelId: isHunyuanAgentMode ? "hunyuan_gpt_175B_0404" : config.model_name,
    ...(isHunyuanAgentMode
      ? { agentModeModelSetting: { modelId: config.model_name } }
      : { subModelId: "" }),
    supportFunctions: {
      internetSearch: config.features.searching ? "openInternetSearch" : "",
    },
    internetSearch,
  };

  return {
    model: "gpt_175B_0404",
    prompt,
    plugin: "",
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
    projectId: "",
    isTemporary: false,
    docOpenid: "",
    applicationIdList: [],
    chatModelExtInfo: JSON.stringify(chatModelExtInfo),
    supportHint: 1,
    version: "v2",
    chatModelId: config.model_name,
    supportFunctions: ["openAutoSearchSwitch", internetSearch],
    extReportParams: null,
    isAtomInput: false,
    conversationId: config.chat_id,
    offsetOfHour: Math.trunc(TIMEZONE_OFFSET_MINUTES / 60),
    offsetOfMinute: TIMEZONE_OFFSET_MINUTES % 60,
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

export function getModels(_cookies: YuanBao.Cookies) {
  return [
    {
      id: "hunyuan_omnipotent_hy4",
      name: "hunyuan_hy4_preview",
    },
    {
      id: "hunyuan_gpt_175B_0404",
      name: "hunyuan",
    },
    {
      id: "hunyuan_gpt_175B_0404_search",
      name: "hunyuan_search",
    },
    {
      id: "hunyuan_gpt_175B_0404_deepsearch",
      name: "hunyuan_deepsearch",
    },
    {
      id: "hunyuan_t1",
      name: "hunyuan_think",
    },
    {
      id: "hunyuan_t1_search",
      name: "hunyuan_think_search",
    },
    {
      id: "deep_seek_v3",
      name: "deepseek",
    },
    {
      id: "deep_seek_v3_search",
      name: "deepseek_search",
    },
    {
      id: "deep_seek",
      name: "deepseek_think",
    },
    {
      id: "deep_seek_search",
      name: "deepseek_think_search",
    },
  ];
}

export function generateHeaders(
  cookies: YuanBao.Cookies,
  security: Record<string, string> = {},
): Record<string, string> {
  const Cookie = [
    `hy_source=web`,
    `hy_user=${cookies.hy_user}`,
    `hy_token=${cookies.token}`,
  ].join("; ");

  const requestHeaders = { ...cookies.requestHeaders };
  const timestamp = security["X-Timestamp"] ??
    requestHeaders["X-Timestamp"] ?? String(Date.now());
  const h38 = security["X-HY92"] ?? requestHeaders["X-HY92"] ?? "";
  const busParams = `h38=${h38}&timestamp=${timestamp}&platform=web`;

  requestHeaders["X-Timestamp"] = timestamp;
  requestHeaders["X-Bus-Params-Md5"] ??= security["X-Bus-Params-Md5"] ??
    md5(busParams);
  requestHeaders["X-Uskey"] ??= security["X-Uskey"] ?? "";
  if (security["X-device-id"]) requestHeaders["X-device-id"] = security["X-device-id"];
  if (security["X-HY93"]) requestHeaders["X-HY93"] = security["X-HY93"];
  if (security["X-HY92"]) requestHeaders["X-HY92"] = security["X-HY92"];

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
    "x-webversion": WEB_VERSION,
    "x-commit-tag": COMMIT_TAG,
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
    ...requestHeaders,
  };
}
