# Yuanbao Deno API

基于 Deno 的 元宝大模型 API 服务。

## 获取Cookie

1. 从 [元宝官网](https://yuanbao.tencent.com/) 获取 cookie：
   - 登录 元宝 官网
   - 右键页面检查
   - 记录Cookie：hy_user、hy_token（对应大模型api密钥）
   - 记录agentid，登录官网后，网页地址会改为`https://yuanbao.tencent.com/chat/*`，`chat/`后面的就是agentid

## 部署到 Deno Deploy

推荐使用 Deno Deploy 进行部署，步骤如下：

1. 在 [Deno Deploy](https://deno.com/deploy) 创建新项目
2. 连接你的 GitHub 仓库，入口文件选main.ts
3. 在项目设置【Settings】中添加环境变量：hy_user、agentid


## 功能

1. 支持流式对话
2. 支持deepseek、混元、混元T1
- model=deep_seek，deepseek chat
- model=deep_seek_search，deepseek chat + 联网搜索
- model=deep_seek_think_search，deepseek r1 + 联网搜索
- model=hunyuan_gpt_175B_0404，混元 chat
- model=hunyuan_gpt_175B_0404_search，混元 chat + 联网搜索
- model=hunyuan_gpt_175B_0404_deepsearch，混元 chat + 深度研究
- model=hunyuan_t1，混元T1
- model=hunyuan_t1_search，混元T1 + 联网搜索
