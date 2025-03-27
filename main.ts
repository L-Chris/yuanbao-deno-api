import { Hono } from 'hono'
import { getChatConfig, mergeMessages } from "./utils.ts";
import { createCompletion, createCompletionStream, createConversation, getModels, removeConversation } from "./api.ts";
import { OpenAI, YuanBao } from "./types.ts";

const app = new Hono()

app.get('/', (c) => c.text('Hello World'))

app.post('/v1/chat/completions', async (c) => {
  const authHeader = c.req.header('authorization') || '';
  const token = authHeader.replace(/^Bearer /, '');

  if (!token) return c.json({
    status: 500,
    message: 'need token'
  })

  const body = await c.req.json()
  const messages: OpenAI.Message[] = body?.messages || [] 

  const chatConfig = getChatConfig({
    chat_id: body.id,
    model: body.model,
    stream: body.stream,
    response_format: body.response_format,
    tools: body.tools,
    tool_choice: body.tool_choice,
    messages: messages
  })

  if (!Array.isArray(messages) || messages.length === 0) return c.json({
    status: 500,
    message: 'need message'
  })

  // const urls = extractFileUrlsFromMessages(messages)
  // await Promise.all(urls.map(_ => uploadFile(_, token)))
  const refs: YuanBao.Attachment[] = []
  const newMessages = mergeMessages(chatConfig, messages, refs)
  const conversation = await createConversation({
    config: chatConfig,
    token,
    messages: newMessages,
    urls: refs,
  })
  chatConfig.chat_id = conversation.id
  // Deno.writeFileSync(`./data/${conversation.id}_req.json`, new TextEncoder().encode(JSON.stringify({
  //   body: body,
  //   new: newMessages
  // })))
  if (chatConfig.stream) {
    const stream = await createCompletionStream({
      config: chatConfig,
      token: token,
      messages: newMessages
    }, () => removeConversation(conversation.id, token))

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  } else {
    const response = await createCompletion({
      config: chatConfig,
      token: token,
      messages: newMessages
    })

    removeConversation(conversation.id, token)

    return c.json(response)
  }
})

app.get('/v1/models', async (c) => {
  const authHeader = c.req.header('authorization') || '';
  const token = authHeader.replace(/^Bearer /, '');
  const models = await getModels({ token })

  return c.json({
    data: models
  })
})

export default app