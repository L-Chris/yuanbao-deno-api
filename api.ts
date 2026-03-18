import { uuid, extractJsonFromContent } from './utils.ts'
import { OpenAI, YuanBao } from './types.ts'
import { approximateTokenSize } from 'tokenx'
import { ChunkTransformer } from './chunk-transformer.ts'
import { parseAssistantMessage } from './assistant-message/parse-assistant-message.ts'

export async function createConversation (params: {
  config: OpenAI.ChatConfig
  cookies: YuanBao.Cookies
  messages: YuanBao.Message[]
  urls: YuanBao.Attachment[]
}) {
  const result = await fetch(
    'https://yuanbao.tencent.com/api/user/agent/conversation/create',
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: params.cookies.agentId
      }),
      headers: generateHeaders(params.cookies)
    }
  )

  const json = await result.json()
  return {
    id: json.id
  }
}

export function removeConversation (convId: string, cookies: YuanBao.Cookies) {
  return fetch(`https://yuanbao.tencent.com/api/user/agent/conversation/v1/clear${convId}`, {
    method: 'POST',
    headers: generateHeaders(cookies),
    body: JSON.stringify({
      uiOptions: {
        noToast: true
      },
      conversationIds: [convId]
    })
  })
}

export async function createCompletionStream (
  params: {
    messages: YuanBao.Message[]
    config: OpenAI.ChatConfig
    cookies: YuanBao.Cookies
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
        ...generateHeaders(params.cookies),
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
        agentId: params.cookies.agentId,
        supportHint: 1,
        version: 'v2',
        chatModelId: params.config.model_name,
        supportFunctions: [params.config.features.searching ? 'supportInternetSearch' : 'closeInternetSearch'],
        ...(params.config.features.deepsearching ? {
          isAiDeepSearch: true,
          searchDeepMode: true,
          searchDeepModeParentCid: params.config.chat_id,
          searchDeepModeParentIndex: 2,
          searchDeepModeParentRepeatIndex: 0,
          speechMode: 5
        } : {})
      })
    }
  )

  const parser = new ChunkTransformer(req, params.config, params.messages)

  parser.onDone(callback)

  return parser.getStream()
}

/** 消费流式响应，累积 content / citations / usage，返回完整 CompletionChunk */
async function consumeStreamToCompletion(
  stream: ReadableStream<Uint8Array>,
  model: string
): Promise<OpenAI.CompletionChunk> {
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let citations: string[] = []
  let usage: OpenAI.CompletionChunk['usage'] = {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2
  }
  let lastError: string | null = null

  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\n\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const line = event.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const chunk: OpenAI.CompletionChunk = JSON.parse(data)
          if (chunk.error) {
            lastError = chunk.error.message
            continue
          }
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) content += delta.content
          if (chunk.citations?.length) citations = chunk.citations
          if (chunk.usage) usage = chunk.usage
        } catch {
          // 忽略单条解析失败
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (lastError) {
    throw new Error(lastError)
  }

  return {
    id: '',
    model,
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: []
        },
        finish_reason: 'stop'
      }
    ],
    citations,
    usage,
    created: Math.trunc(Date.now() / 1000)
  }
}

export async function createCompletion (params: {
  messages: YuanBao.Message[]
  config: OpenAI.ChatConfig
  cookies: YuanBao.Cookies
}) {
  const config = params.config
  const isJson = params.config.response_format.type === 'json_schema'
  const lastMessage = params.messages.findLast(_ => _.role === 'user')!

  if (isJson) {
    // 如果是JSON格式，添加特殊指令：只返回数据本身，不要返回带 $schema/type/items 的包装
    const schema = params.config.response_format?.json_schema
      ? `
请严格按照以下 JSON Schema 的结构返回数据，注意：
- 不要返回多余的额外文本描述，不要返回引用链接如"[citation:1]"，只返回json
- 只返回json数据本身（例如 schema 要求是 array 就只返回 [...]，是 object 就只返回 {...}），不要返回包含 $schema、type、items 等字段的 schema 包装对象。
- Schema：
${JSON.stringify(params.config.response_format.json_schema, null, 2)}`
      : '\n请以有效的JSON格式返回响应，只返回数据本身，不要返回 schema 包装。'

    lastMessage.content = `${
      Array.isArray(lastMessage.content)
        ? lastMessage.content[0].text
        : lastMessage.content
    }${schema}`
  }

  const prompt = params.messages.reduce((pre, cur) => {
    if (Array.isArray(cur.content)) {
      return pre + cur.content.map(c => c.text).join('\n')
    } else {
      return pre + cur.content
    }
  }, '')

  const req = await fetch(
    `https://yuanbao.tencent.com/api/chat/${config.chat_id}`,
    {
      method: 'POST',
      headers: {
        ...generateHeaders(params.cookies),
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
        agentId: params.cookies.agentId,
        supportHint: 1,
        version: 'v2',
        chatModelId: config.model_name,
        supportFunctions: [config.features.searching ? 'supportInternetSearch' : 'closeInternetSearch'],
        ...(config.features.deepsearching ? {
          isAiDeepSearch: true,
          searchDeepMode: true,
          searchDeepModeParentCid: config.chat_id,
          searchDeepModeParentIndex: 2,
          searchDeepModeParentRepeatIndex: 0,
          speechMode: 5
        } : {})
      })
    }
  )

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.indexOf('text/event-stream') < 0) {
    const text = await req.text()
    throw new Error(contentType.includes('text/html') ? 'rejected by server' : text || req.statusText)
  }

  const parser = new ChunkTransformer(req, config, params.messages)
  const stream = parser.getStream()
  const message = await consumeStreamToCompletion(stream, config.model_name)
  return formatMessageResponse(message, params.messages, config.response_format, config.tools)
}

export async function getModels (cookies: YuanBao.Cookies) {
  return [
    {
      id: 'deep_seek',
      name: "deepseek",
    },
    {
      id: 'deep_seek_search',
      name: "deepseek_search",
    },
    {
      id: 'deep_seek_think_search',
      name: "deepseek_think_search",
    },
    {
      id: 'gpt_175B_0404_deepsearch',
      name: "hunyuan_deepsearch",
    },
    {
      id: 'gpt_175B_0404',
      name: "hunyuan",
    },
    {
      id: 'hunyuan_t1_think',
      name: "hunyuan_think",
    },
    {
      id: 'hunyuan_t1_think_search',
      name: "hunyuan_think_search",
    },
    {
      id: 'gpt_175B_0404_search',
      name: "hunyuan_search",
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

export function generateHeaders (cookies: YuanBao.Cookies) {
  const Cookie = [
    `hy_source=web`,
    `hy_user=${cookies.hy_user}`,
    `hy_token=${cookies.token}`
  ].join('; ')

  return {
    Cookie,
    'chat_version': 'v1',
    'x-agentid': cookies.agentId,
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
