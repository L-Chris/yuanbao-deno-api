import { buildCompletionBody, generateHeaders, getModels } from "./api.ts";
import { OpenAI, YuanBao } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cookies: YuanBao.Cookies = {
  token: "test-token",
  agentId: "test-agent",
  hy_user: "test-user",
  requestHeaders: {},
};

Deno.test("generateHeaders uses the current web protocol", () => {
  const headers = generateHeaders(cookies);

  assert(headers["x-webversion"] === "2.83.11", "unexpected web version");
  assert(headers["x-commit-tag"] === "0d2b8477", "unexpected commit tag");
  assert(/^\d{13}$/.test(headers["X-Timestamp"]), "missing timestamp");
  assert(
    /^[a-f0-9]{32}$/.test(headers["X-Bus-Params-Md5"]),
    "missing bus parameter digest",
  );
  assert(headers["X-Uskey"] === "", "default USKey must be empty");
});

Deno.test("generateHeaders preserves a captured browser signature", () => {
  const headers = generateHeaders({
    ...cookies,
    requestHeaders: {
      "X-Uskey": "captured-uskey",
      "X-Bus-Params-Md5": "captured-md5",
      "X-Timestamp": "1700000000000",
      "X-HY92": "captured-h38",
    },
  });

  assert(headers["X-Uskey"] === "captured-uskey", "USKey was replaced");
  assert(
    headers["X-Bus-Params-Md5"] === "captured-md5",
    "browser digest was replaced",
  );
  assert(
    headers["X-Timestamp"] === "1700000000000",
    "browser timestamp was replaced",
  );
});

Deno.test("models and completion body match the current website", () => {
  const modelIds = getModels(cookies).map((model) => model.id);
  assert(
    modelIds.includes("hunyuan_gpt_175B_0404"),
    "current Hunyuan model is missing",
  );
  assert(modelIds.includes("deep_seek_v3"), "DeepSeek V3 is missing");

  const config: OpenAI.ChatConfig = {
    chat_id: "test-conversation",
    chat_type: "t2t",
    model_name: "hunyuan_gpt_175B_0404",
    response_format: { type: "text" },
    features: {
      thinking: false,
      searching: false,
      deepsearching: false,
    },
    stream: true,
    tools: [],
    tool_choice: "auto",
    is_tool_calling: false,
    is_tool_calling_done: false,
  };
  const body = buildCompletionBody({
    prompt: "hello",
    config,
    cookies,
  });
  const modelExtInfo = JSON.parse(body.chatModelExtInfo);

  assert(body.supportHint === 1, "unexpected supportHint");
  assert(body.projectId === "", "projectId must be present");
  assert(body.applicationIdList.length === 0, "unexpected applications");
  assert(
    body.supportFunctions.join(",") ===
      "openAutoSearchSwitch,autoInternetSearch",
    "unexpected support functions",
  );
  assert(
    body.conversationId === "test-conversation",
    "conversationId must be present",
  );
  assert(body.offsetOfHour === 8, "unexpected timezone offset");
  assert(!("deleteIndex" in body), "new chats must omit deleteIndex");
  assert(
    modelExtInfo.modelId === "hunyuan_gpt_175B_0404",
    "chatModelExtInfo contains the wrong model",
  );

  const agentModeBody = buildCompletionBody({
    prompt: "hello",
    config: { ...config, model_name: "hunyuan_t1" },
    cookies,
  });
  const agentModeExtInfo = JSON.parse(agentModeBody.chatModelExtInfo);
  assert(
    agentModeExtInfo.modelId === "hunyuan_gpt_175B_0404",
    "agent mode must retain its parent model",
  );
  assert(
    agentModeExtInfo.agentModeModelSetting?.modelId === "hunyuan_t1",
    "agent mode model setting is missing",
  );
});
