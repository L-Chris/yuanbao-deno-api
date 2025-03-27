import { uuid, extractJsonFromContent } from './utils.ts'
import { OpenAI, YuanBao } from './types.ts'
import { approximateTokenSize } from 'tokenx'
import { ChunkTransformer } from './chunk-transformer.ts'
import { parseAssistantMessage } from './assistant-message/parse-assistant-message.ts'

export async function createConversation (params: {
  config: OpenAI.ChatConfig
  token: string
  messages: YuanBao.Message[]
  urls: YuanBao.Attachment[]
}) {
  const result = await fetch(
    'https://yuanbao.tencent.com/api/user/agent/conversation/create',
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'naQivTmsDa'
      }),
      headers: generateHeaders(params.token)
    }
  )

  const json = await result.json()

  return {
    id: json.id
  }
}

export function removeConversation (convId: string, ticket: string) {
  return fetch(`https://chat.qwen.ai/api/v1/chats/${convId}`, {
    method: 'DELETE',
    headers: generateHeaders(ticket)
  })
}

export async function createCompletionStream (
  params: {
    messages: YuanBao.Message[]
    config: OpenAI.ChatConfig
    token: string
  },
  callback = () => {}
) {
  const prompt = params.messages.reduce((pre, cur) => {
    if (Array.isArray(cur.content)) {
      return pre + cur.content.map(c => c.text).join('\n')
    } else {
      return pre + cur.content
    }
  }, '')
  const req = await fetch(
    `https://yuanbao.tencent.com/api/chat/${params.config.chat_id}`,
    {
      method: 'POST',
      headers: {
        ...generateHeaders(params.token),
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        model: 'gpt_175B_0404',
        prompt: prompt,
        plugin: 'Adaptive',
        displayPrompt: prompt,
        displayPromptType: 1,
        options: {
          imageIntention: {
            needIntentionModel: true,
            backendUpdateFlag: 2,
            intentionStatus: true
          }
        },
        multimedia: [],
        agentId: 'naQivTmsDa',
        supportHint: 1,
        version: 'v2',
        chatModelId: params.config.model_name,
        supportFunctions: [params.config.features.searching ? 'supportInternetSearch' : '']
      })
    }
  )

  const parser = new ChunkTransformer(req, params.config, params.messages)

  parser.onDone(callback)

  return parser.getStream()
}

export async function createCompletion (params: {
  messages: YuanBao.Message[]
  config: OpenAI.ChatConfig
  token: string
}) {
  const config = params.config
  const isJson = params.config.response_format.type === 'json_schema'
  const lastMessage = params.messages.findLast(_ => _.role === 'user')!

  if (isJson) {
    // 如果是JSON格式，添加特殊指令
    const schema = params.config.response_format?.json_schema
      ? `\n按照以下JSON Schema格式返回：\n${JSON.stringify(
          params.config.response_format.json_schema,
          null,
          2
        )}`
      : '\n请以有效的JSON格式返回响应。'

    lastMessage.content = `${
      Array.isArray(lastMessage.content)
        ? lastMessage.content[0].text
        : lastMessage.content
    }${schema}`
  }

  const req = await fetch(`https://yuanbao.tencent.com/api/chat/${params.config.chat_id}`, {
    method: 'POST',
    headers: generateHeaders(params.token),
    body: JSON.stringify({
      chat_id: config.chat_id,
      model: config.model_name,
      incremental_output: false,
      chat_type: config.chat_type,
      session_id: uuid(),
      stream: false,
      feature_config: {
        thinking_enabled: params.config.features.thinking
      },
      messages: params.messages
    })
  })

  const body = await req.json()

  const message: OpenAI.CompletionChunk = {
    id: '',
    model: config.model_name,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: body?.choices?.[0]?.message?.content || '',
          tool_calls: []
        },
        finish_reason: 'stop'
      }
    ],
    citations: [] as string[],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    },
    created: Math.trunc(Date.now() / 1000)
  }

  return formatMessageResponse(
    message,
    params.messages,
    config.response_format,
    config.tools
  )
}

export async function getModels (params: { token: string }) {
  return [
    {
      id: 'deep_seek',
      name: "deepseek",
    },
    {
      id: 'deep_seek',
      name: "deepseek_think",
    },
    {
      id: 'deep_seek',
      name: "deepseek_think_search",
    },
  ]
}

function formatMessageResponse (
  message: OpenAI.CompletionChunk,
  promptMessages: OpenAI.Message[],
  response_format?: OpenAI.ChatConfig['response_format'],
  tools?: OpenAI.Tool[]
) {
  if (!message.choices[0].message) return message

  const prompt = promptMessages.reduce(
    (acc, cur) =>
      acc +
      (Array.isArray(cur.content)
        ? cur.content.map(_ => _.text).join('')
        : cur.content),
    ''
  )
  const prompt_tokens = approximateTokenSize(prompt)
  const completion_tokens = approximateTokenSize(
    message.choices[0].message.content
  )

  message.usage = {
    prompt_tokens: prompt_tokens,
    completion_tokens: completion_tokens,
    total_tokens: prompt_tokens + completion_tokens
  }
  if (response_format?.type === 'json_schema') {
    const json = extractJsonFromContent(message.choices[0].message.content)
    if (json) {
      message.choices[0].message.content = JSON.stringify(json)
    }
  }

  if (!tools?.length) return message
  const blocks = parseAssistantMessage(message.choices[0].message.content)
  message.choices[0].message.content = blocks
    .filter(_ => _.type === 'text')
    .map(_ => _.content)
    .join('')
  message.choices[0].message.tool_calls = blocks
    .filter(_ => _.type === 'tool_use')
    .map(_ => ({
      id: uuid(),
      type: 'function',
      function: {
        name: _.params.tool_name!,
        arguments: _.params.arguments || ''
      }
    }))

  return message
}

export function generateHeaders (token: string) {
  const Cookie = [
    `hy_user=${Deno.env.get('hy_user')}`,
    `hy_token=${token}`
  ].join('; ')

  return {
    Cookie,
    'chat_version': 'v1',
    'x-agentid': 'naQivTmsDa',
    'content-type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    Origin: 'https://yuanbao.tencent.com',
    Pragma: 'no-cache',
    'Sec-Ch-Ua':
      '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    Referer: 'https://yuanbao.tencent.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  }
}
