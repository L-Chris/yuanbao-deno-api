import { crypto } from 'https://deno.land/std/crypto/mod.ts'
import _ from 'lodash'
import { OpenAI, YuanBao } from "./types.ts";
import { SYSTEM_PROMPT } from "./assistant-message/prompts.ts";

export const uuid = () => crypto.randomUUID()

export const getChatConfig = (body: {
  stream?: boolean
  chat_id?: string
  response_format?: OpenAI.ChatConfig['response_format']
  model: string
  tools?: OpenAI.Tool[]
  tool_choice?: OpenAI.ToolChoice
  messages: OpenAI.Message[]
}): OpenAI.ChatConfig => {
  const parts = body.model!.split('_')
  const model_name = parts.filter(_ => !['think', 'search'].includes(_)).join('_')
  const response_format: OpenAI.ChatConfig['response_format'] = body.response_format?.type ? body.response_format : { type: 'text' }
  const stream = typeof body.stream === 'boolean' ? body.stream : false
  const tools: OpenAI.Tool[] = body.tools || []
  const is_tool_calling = tools.length > 0 && !body.messages.some(m => m.role === 'tool')
  const is_tool_calling_done = tools.length > 0 && body.messages.some(m => m.role === 'tool')
  const returnArtifacts = response_format.type === 'json_schema' || is_tool_calling
  return {  
    model_name: model_name,
    features: {
      thinking: parts.includes('think'),
      searching: parts.includes('search'),
    },
    response_format: response_format,
    chat_id: body.chat_id || '',
    chat_type: parts.includes('search') ? 'search' : returnArtifacts ? 'artifacts' : 't2t',
    stream,
    tools: tools,
    tool_choice: body.tool_choice || 'auto',
    is_tool_calling,
    is_tool_calling_done
  }
}

export function mergeMessages (
  config: OpenAI.ChatConfig,
  data: OpenAI.Message[],
  urls: YuanBao.Attachment[] = []
): YuanBao.Message[] {
  const systemMessages = data.filter(m => m.role === 'system')

  if (systemMessages.length === 0 && config.tools.length > 0) {
    systemMessages.push({
      role: 'system',
      content: SYSTEM_PROMPT(config.tools)
    })
  }

  const content = data.filter(m => m.role !== 'system').reduce((pre: string, message) => {
    if (Array.isArray(message.content)) {
      return message.content.reduce((_content, v) => {
        if (!_.isObject(v) || v.type != 'text') return _content
        return (
          _content + `<message>${message.role || 'user'}\n${v.text}</message>\n`
        )
      }, pre)
    }

    if (message.role === 'assistant' && message.tool_calls?.length) return pre

    if (message.role === 'tool') {
      const tool_calls = data.find(_ => _.tool_calls?.length && _.role === 'assistant')?.tool_calls || []
      const tool_name = tool_calls.find(_ => _.id === message.tool_call_id)?.function.name || message.tool_call_id
      const text = `<message>[use_function_tool for '${tool_name}'] Result:\n${message.content}</message>\n`
      pre += text
      return pre
    }

    const text = `<message>${message.role || 'user'}\n${message.content}</message>\n`
    pre += text
    return pre
  }, '')

  return [
    ...systemMessages,
    {
      role: 'user',
      content: [
        {
          text: content,
          type: 'text'
        },
        ...urls.map(_ => ({ type: _.type, image: _.id }))
      ]
    }
  ]
}

export function extractFileUrlsFromMessages (data: OpenAI.Message[]) {
  const res: string[] = []

  if (!data.length) return res

  const lastMessage = data[data.length - 1]

  if (Array.isArray(lastMessage.content)) {
    lastMessage.content.forEach(v => {
      if (!_.isObject(v) || !['file', 'image_url'].includes(v.type)) return
      if (v['type'] == 'file' && _.isString(v.file_url?.url)) {
        res.push(v.file_url?.url!)
      } else if (v['type'] == 'image_url' && _.isString(v.image_url?.url)) {
        // 兼容gpt-4-vision-preview API格式
        res.push(v.image_url?.url!)
      }
    })
  }

  return res
}

export function extractJsonFromContent (data: string) {
  try {
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = data.match(jsonRegex);
    
    if (!match || !match[1]) return JSON.parse(data);
    
    const jsonString = match[1].trim();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('解析JSON失败:', error);
    return null;
  }
}

export const dataUtil = {
  isBASE64Data (value: string) {
    return _.isString(value) && /^data:/.test(value)
  },
  extractBASE64DataFormat (value: string) {
    const match = value.trim().match(/^data:(.+);base64,/)
    if (!match) return null
    return match[1]
  },
  removeBASE64DataHeader (value: string): string {
    return value.replace(/^data:(.+);base64,/, '')
  },
  base64ToUint8Array (string: string) {
    return Uint8Array.from(atob(string), c => c.charCodeAt(0))
  },
  isImageMime (_: string) {
    return [
      'image/jpeg',
      'image/jpg',
      'image/tiff',
      'image/png',
      'image/bmp',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'image/ico',
      'image/heic',
      'image/heif',
      'image/bmp',
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/x-png'
    ].includes(_)
  }
}