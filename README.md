# Yuanbao Deno API

基于 Deno 的 元宝大模型 API 服务。

## 认证方式

通过 `Authorization` Header 传递认证信息，格式为：

```
Authorization: Bearer token:<your_token> agentId:<your_agentid> hy_user:<your_hy_user>
```

参数说明：

- `token`: 元宝 API 密钥（hy_token）
- `agentId`: 智能体 ID，登录官网后从 URL
  `https://yuanbao.tencent.com/chat/<agentId>` 获取
- `hy_user`: 用户标识，从浏览器 Cookie 中获取

### 获取方式

1. 登录 [元宝官网](https://yuanbao.tencent.com/)
2. 按 `F12` 打开开发者工具 → Application/Storage → Cookies
3. 记录 `hy_user` 和 `hy_token` 的值
4. 从 URL 中获取 `agentId`（`chat/` 后面的部分）

### 新版网页安全请求头

元宝网页 `2.83.11` 为创建会话和聊天接口增加了 QIMEI/请求签名头（缺少时返回
“服务繁忙，请稍后再试。”）。

#### 自动签名（推荐）

配置 `YUANBAO_BROWSERLESS_WS` 指向一个
[browserless](https://github.com/browserless/browserless) 服务（例如
`ws://browserless-chromium:3000`）后，服务会在首次请求时打开一个带登录态
Cookie 的元宝页面，调用页面内 QIMEI SDK 的 `getUSKeySync` 自动生成
`X-Uskey`、`X-Bus-Params-Md5`、`X-Timestamp`、`X-HY92`、`X-HY93` 等签名头,
会话常驻复用，后续签名仅毫秒级。

相关环境变量：

- `YUANBAO_BROWSERLESS_WS`: browserless WebSocket 地址；留空则退回手动透传模式
- `YUANBAO_QIMEI_APP_KEY` / `YUANBAO_QIMEI_APP_ID`: QIMEI 签名常量，默认值对应当前网页版
- `YUANBAO_QIMEI_MODULE_IDS`: QIMEI SDK webpack 模块 ID 列表（官网改版后可调整）

注意：首次请求需要初始化浏览器页面（约 10-60 秒），之后复用会话；部署机出口
IP 最好与账号登录 IP 一致，避免触发元宝风控。

#### 手动透传模式

未配置 browserless 且账号侧启用了严格校验时，需要从浏览器对应请求中复制动态
安全头，并通过以下 Header 透传：

```text
X-Yuanbao-Uskey: <X-Uskey>
X-Yuanbao-Bus-Params-Md5: <X-Bus-Params-Md5>
X-Yuanbao-Timestamp: <X-Timestamp>
X-Yuanbao-Device-Id: <X-device-id>
X-Yuanbao-HY92: <X-HY92>
X-Yuanbao-HY93: <X-HY93>
```

其中 `X-Uskey`、摘要和时间戳是一组动态值，应一起更新。聊天请求的 `X-Traceparent`
会由服务自动生成。也可用环境变量 `YUANBAO_WEB_VERSION`、 `YUANBAO_COMMIT_TAG` 和
`YUANBAO_TIMEZONE_OFFSET_MINUTES` 覆盖网页版本及客户端时区信息。

## 部署到 Deno Deploy

推荐使用 Deno Deploy 进行部署，步骤如下：

1. 在 [Deno Deploy](https://deno.com/deploy) 创建新项目
2. 连接你的 GitHub 仓库，入口文件选 `main.ts`
3. 部署完成即可使用（认证信息通过请求 Header 传递，无需配置环境变量）

## 功能

1. 支持流式对话
2. 支持deepseek、混元、混元T1

- model=deep_seek_v3，deepseek chat
- model=deep_seek_v3_search，deepseek chat + 联网搜索
- model=deep_seek，deepseek 深度思考
- model=deep_seek_search，deepseek 深度思考 + 联网搜索
- model=hunyuan_gpt_175B_0404，混元 chat
- model=hunyuan_gpt_175B_0404_search，混元 chat + 联网搜索
- model=hunyuan_gpt_175B_0404_deepsearch，混元 chat + 深度研究
- model=hunyuan_t1，混元T1
- model=hunyuan_t1_search，混元T1 + 联网搜索

## 使用示例

```bash
curl https://your-deno-deploy-url.deno.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token:xxx agentId:xxx hy_user:xxx" \
  -d '{
    "model": "deep_seek",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 官网改版排查指南（逆向经验记录）

记录于 2026-09，网页版本 `2.83.11`（commit tag `0d2b8477`）。官网改版后按此
顺序排查，通常 1-2 小时内可定位并修复。

### 1. 故障现象速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| SSE `{"type":"error","msg":"服务繁忙，请稍后再试。"}` | 缺签名头（X-Uskey 校验失败）或请求体不合规 | 走第 2、3 节 |
| HTTP 401 `code: 20002 登录态已过期` | `hy_token` 过期 | 重新登录官网取 Cookie |
| 401 但浏览器里能正常用 | 部署机出口 IP 与登录 IP 不一致触发风控 | 同机登录或更换出口 |
| 响应正常但内容混杂 `[](@mark_*)`、`[n,m](@ref)` | 元宝私有富文本标记 | `chunk-transformer.ts` 已清洗，出现新标记时补充正则 |

### 2. 前端包定位

1. `curl -s https://yuanbao.tencent.com/ -o home.html`，枚举所有
   `<script src>`。**注意：webpack runtime 的 chunk map（`.u` 函数）只覆盖
   按需 chunk，页面顶层直接引用的脚本必须单独抓**，关键文件：
   - `yb_v2_pages/_app.*.js` —— 请求层/签名逻辑所在（容易漏！）
   - `yb_v2_pages/index.*.js`、`yb_v2_yb-chat/yb-util/yb-component.*.js`
   - `yb_v2_vendor_qimei.*.js` —— QIMEI 加密库（AES 实现）
2. 全部下载后按需 `js-beautify`，用关键字符串检索：
   `getUSKeySync`、`X-Uskey`、`reqHeaders`、`platform=web`、`h38=`、
   `0WEB`（appKey 前缀）、接口路径片段（如 `conversation/create`）。

### 3. 签名机制快照（2.83.11 / commit 0d2b8477）

- 入口：`_app.*.js` 模块 `28850`（导出 `TE/m` 签名、`f8` 注入）。
- 签名白名单：URL 以 `/api` 开头且包含以下任一片段才签名：
  `/user/agent/conversation/create`、`/chat/`、`/joint/login`、`/login/*`、
  `/cauth/login`、`/anon/login`、`/accountLogic/login/config|accountList`。
  **`/v1/clear`（删会话）不在白名单，无需签名。**
- QIMEI 实例：模块 `77004` 转发自模块 `12601`（`I5(appKey)` 取实例）。
  appKey 定义在 `yb-util` 模块 `89706`：默认 `0WEB05U9OEC1ZNRY`，
  `/evt` 页面用 `0WEB05ZQ6ZT9YGOE`。
- 算法：

  ```text
  h38     = inst.getLocalQimei36().h38            # 38 字符
  ts      = Date.now()
  params  = `h38=${h38}&timestamp=${ts}&platform=web`
  X-Uskey          = encodeURIComponent(inst.getUSKeySync("7800385", h38, params))
  X-Bus-Params-Md5 = md5(params)
  X-Timestamp      = ts
  X-HY92 = h38；X-HY93 = X-device-id = localStorage["_qimei_uuid42"]
  ```

  校验方式：拿浏览器真实请求的三元组代入上式，应能复算出相同的
  `X-Bus-Params-Md5`。

### 4. 在线调试（browserless + CDP）

本仓库 `signer.ts` 就是可用的最小 CDP 客户端，改官网后优先在它上面实验：

1. 创建标签页：`PUT http://<browserless>/json/new?about%3Ablank`（注意是
   PUT），返回体里的 `webSocketDebuggerUrl` 主机名要替换成 browserless 地址。
2. CDP 流程：`Network.setCookies`（`hy_source/hy_user/hy_token`，domain
   `.tencent.com`）→ `Page.navigate` 到 `/chat/<agentId>` → 轮询
   `Runtime.evaluate` 直到 `h38` 就绪（一般 10-40 秒）。
3. 页面内注入拿 webpack require：

   ```js
   let wr = null;
   self.webpackChunk_N_E.push([[`__tag_${Date.now()}`], {}, (req) => wr = req]);
   // wr(id) 取模块；wr.m 是全部模块工厂表，可 toString() 扫描特征字符串
   ```

4. 对照真实请求头：puppeteer 的 `page.on("request")` 或 CDP
   `Network.requestWillBeSent` 抓页面自己发出的 `/api/*` 请求，逐头 diff。
5. 当前模型列表：`POST /api/agent/model/list`，body `{"agentId":"<id>"}`，
   无需签名。**未列出的模型（如 `hunyuan_t1`、`hunyuan_omnipotent_hy4`）
   不一定失效，以实测 `/api/chat` 为准。**

### 5. 踩过的坑

- **webpack 模块 ID、appKey、chunk 文件名哈希每次发版都会变**——所以
  `signer.ts` 采用“已知模块 ID（`YUANBAO_QIMEI_MODULE_IDS` 可覆盖）+ 扫描
  含 `getUSKeySync` 的模块工厂”两级定位，改版后通常无需改代码。
- **页面脚本不在 runtime chunk map 里**：只按 `.u` 映射下载会漏掉
  `_app` / `yb_v2_*` 顶层脚本，签名逻辑恰好在 `_app` 中。
- **CDP 里拼 JS 时，`const x = <多语句模板>` 只会取第一条语句的返回值**。
  曾因此把 `push()` 的返回（数组长度）当成 webpack require，排查了很久。
  模板必须是单个 IIFE 表达式。
- `X-Uskey` 值内含 `%0A`（换行）是正常现象，不要做 URL 解码。
- 聊天请求体关键字段（改版时重点核对）：`plugin: ""`、`model: "gpt_175B_0404"`
  （固定值，与 `chatModelId` 不同）、`chatModelExtInfo`（JSON 字符串）、
  `supportFunctions: ["openAutoSearchSwitch", ...]`、`conversationId`、
  `offsetOfHour/offsetOfMinute`；请求头 `content-type: text/plain;charset=UTF-8`、
  `chat_version: v1`、`X-Input-Type: text`、`X-Event-Input-Type: 11`。
- 会话创建后直接聊天即可，`updateModel` 步骤经实测可省略。

### 6. 改版修复清单

1. `deno run --allow-net --allow-read --allow-env` 本地起服务或直接用
   `signer.ts` 验证：签名还能否生成？生成的头过不过 `/api/chat`？
2. 签名失败 → 按第 2、3 节找新的模块 ID / appKey，用环境变量覆盖或改
   `signer.ts` 的 `KNOWN_QIMEI_MODULE_IDS` 默认值。
3. 请求体被拒 → 抓真实请求，对照第 5 节字段表更新 `buildCompletionBody`，
   并同步 `api_test.ts` 断言。
4. 更新 `x-webversion` / `x-commit-tag`（`YUANBAO_WEB_VERSION` /
   `YUANBAO_COMMIT_TAG` 环境变量可临时覆盖，不必改代码）。
5. 回归：`deno test --allow-env` + 实测非流式/流式/`_search`/`_deepsearch`
   各一个模型。
