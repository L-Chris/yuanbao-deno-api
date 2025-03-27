import { createParser } from 'eventsource-parser'
import { OpenAI, YuanBao } from './types.ts'
import { approximateTokenSize } from 'tokenx'
import { uuid } from "./utils.ts";
import { parseAssistantMessage } from "./assistant-message/index.ts";

export class ChunkTransformer {
  private streamController!: ReadableStreamDefaultController
  private stream: ReadableStream
  private encoder = new TextEncoder()
  private decoder = new TextDecoder()
  private content = ''
  private config: OpenAI.ChatConfig
  private isThinking = false
  private messages: OpenAI.Message[] = []
  private sentBlockIndex = -1
  private parser = createParser({
    onEvent: e => {
      this.parse(e)
    }
  })
  private callbacks: (() => void)[] = []

  constructor (req: Response, config: OpenAI.ChatConfig, messages: OpenAI.Message[]) {
    this.messages = messages
    this.config = config
    this.stream = new ReadableStream({
      start: controller => {
        this.streamController = controller
        this.read(req)
      }
    })
  }

  // 根据对接模型修改
  private parse (e: EventSourceMessage) {
    if (!e.data) return

    if (/^[[a-z]/.test(e.data)) return

    const chunkData: YuanBao.CompletionChunk = JSON.parse(e.data)
    const chunkType = this.getChunkType(chunkData)

    switch (chunkType) {
      case CHUNK_TYPE.TEXT: {
        const textChunk = chunkData as YuanBao.CompletionChunkText
        if (!textChunk.msg) return
        this.content += textChunk.msg
        this.send({ 
          content: textChunk.msg
        })
        break
      }
      case CHUNK_TYPE.THINKING: {
        const thinkChunk = chunkData as YuanBao.CompletionChunkThink
        this.content += thinkChunk.content
        this.send({ 
          reasoning_content: thinkChunk.content
        })
        break
      }
      case CHUNK_TYPE.SEARCHING_DONE: {
        const searchChunk = chunkData as YuanBao.CompletionChunkSearch
        this.send({ citations: searchChunk.docs.map(doc => doc.url) })
        break
      }
    }
  }

  // 根据对接模型修改
  private getChunkType (chunk: YuanBao.CompletionChunk) {
    if (chunk.type === 'think') return CHUNK_TYPE.THINKING
    if (chunk.type === 'text') return CHUNK_TYPE.TEXT
    if (chunk.type === 'searchGuid') return CHUNK_TYPE.SEARCHING_DONE
    if (chunk.type === 'meta') return CHUNK_TYPE.START
    return CHUNK_TYPE.NONE
  }

  private async read (req: Response) {
    if (!this.streamController) return
    try {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.indexOf('text/event-stream') < 0) {
        const body = await req.text()
        this.send({ error: contentType === 'text/html' ? 'rejected by server' : body })
        this.send({ done: true })
        return
      }

      const reader = req.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        // console.log('read', done, decodedValue)
        if (done) {
          this.send({ done: true })
          return
        }
        const decodedValue = this.decoder.decode(value)
        this.parser.feed(decodedValue)
      }
    } catch (err) {
      this.send({ error: err instanceof Error ? err.message : 'unknown error' })
      this.send({ done: true })
    }
  }

  private send (params: {
    content?: string
    reasoning_content?: string
    citations?: string[]
    error?: string
    done?: boolean
  }) {
    this.content += (params.reasoning_content || '') + (params.content || '')
    const message: OpenAI.CompletionChunk = {
      id: '',
      model: this.config.model_name,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
            role: 'assistant',
            content: params.content || '',
            reasoning_content: params.reasoning_content || ''
        },
        finish_reason: null
      }],
      citations: params.citations || [],
      created: Math.trunc(Date.now() / 1000)
    }

    if (params.error) {
        message.error = {
            message: params.error,
            type: 'server error'
        }

        this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
        return
    }

    if (this.config.tools?.length > 0) {
      const blocks = parseAssistantMessage(this.content)
      const block = blocks[this.sentBlockIndex + 1]
      // 只发送完整的块
      if (block && !block.partial) {
        if (block.type === 'text') {
          const thinkingOpenTagIndex = block.content.indexOf('<thinking>')
          const thinkingCloseTagIndex = block.content.indexOf('</thinking>')
          if (thinkingOpenTagIndex >= 0 && thinkingCloseTagIndex >= 0) {
            message.choices[0].delta!.content = block.content.slice(thinkingCloseTagIndex + 11)
            message.choices[0].delta!.reasoning_content = block.content.slice(thinkingOpenTagIndex + 10, thinkingCloseTagIndex)
          } else {
            message.choices[0].delta!.content = block.content
            message.choices[0].delta!.reasoning_content = ''
          }
        } else if (block.type === 'tool_use') {
          message.choices[0].delta!.content = ''
          message.choices[0].delta!.reasoning_content = ''
          message.choices[0].delta!.tool_calls = [
            {
              id: uuid(),
              type: 'function',
              function: {
                name: block.params.tool_name!,
                arguments: block.params.arguments || ''
              }
            }
          ]
          message.choices[0].finish_reason = 'tool_calls'
        }
        // Deno.writeFileSync(`./data/${this.config.chat_id}_res_1.json`, new TextEncoder().encode(JSON.stringify(message)))
        this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
        this.sentBlockIndex++
        message.choices[0].delta!.content = ''
        message.choices[0].delta!.reasoning_content = ''
        message.choices[0].delta!.tool_calls = []
      }
    }

    if (params.done) {
        if (this.config.tools?.length > 0 && this.sentBlockIndex === -1) {
          message.choices[0].delta!.content = this.content
        }
        const prompt_tokens = approximateTokenSize(this.messages.reduce((acc, cur) => acc + (Array.isArray(cur.content) ? cur.content.map(_ => _.text).join('') : cur.content), ''))
        const completion_tokens = approximateTokenSize(this.content)
        message.usage = {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens + completion_tokens   
        }
        message.choices[0].finish_reason = 'stop'
        this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
        // Deno.writeFileSync(`./data/${this.config.chat_id}_res_2.json`, new TextEncoder().encode(JSON.stringify(message)))
        this.streamController.enqueue(this.encoder.encode(`data: [DONE]\n\n`))
        this.streamController.close()
        this.callbacks.forEach(cb => cb())
        return
    }

    if (this.config.tools?.length === 0) {
      this.streamController.enqueue(this.encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
    }
  }

  onDone(cb: () => void) {
    this.callbacks.push(cb)
  }

  getStream() {
    return this.stream
  }
}

interface EventSourceMessage {
  data: string
  event?: string
  id?: string
}

export enum CHUNK_TYPE {
  ERROR = 'ERROR',
  START = 'START', // 提供基础信息，如chatid
  DEEPSEARCHING = 'DEEPSEARCHING',
  SEARCHING = 'SEARCHING',
  SEARCHING_DONE = 'SEARCHING_DONE',
  THINKING = 'THINKING',
  TEXT = 'TEXT',
  SUGGESTION = 'SUGGESTION',
  DONE = 'DONE',
  NONE = 'NONE'
}
