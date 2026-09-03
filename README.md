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

元宝网页 `2.83.11` 为创建会话和聊天接口增加了 QIMEI/请求签名头。服务会自动生成无
QIMEI 场景下的 `X-Timestamp`、`X-Bus-Params-Md5` 和空
`X-Uskey`。如果账号侧启用了严格校验，需要从浏览器对应请求中复制动态安全头，并通过以下
Header 透传：

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
