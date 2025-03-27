import { Hono } from 'hono'
import { getChatConfig, mergeMessages } from "./utils.ts";
import { createCompletion, createCompletionStream, createConversation, getModels, removeConversation } from "./api.ts";
import { OpenAI, YuanBao } from "./types.ts";

// Deno.env.set('ssxmod_itna', 'GqmxgGD=e7T4hx+2DfxQqqiFm7wD7Dl4BtGRDeq7UQGcD8hD0Pgmj0YGkFD2nLAUxSKD/+DeGzDiuPGhDBWYHoKY34qCsAeObr4BQegF+esK8BTO3KbQmSGhpd5OCgu+Ye40aDbqGkF0wwiDYYvDBYD74G+DDeDixGmSqDS3xD9DGPKpjbd1eDEDYPKxA3Di4D+7niDmMxDGdEZD7jWzlqD0q=nbGhx67WWywcbI1bdi1dKx0UWDBd3C/qKsZgAViTWrzLi5RiDzMkDtuRb9jXOwgrtXQniYG=BqgUx4h++l7Gc/DwezvhNQDK7xCDYriKjnxfiIkQXK34DDc=/i7e4zbGa4xBKHgtHS4rZj4CKOC4xG+GPKDPYDxKi7lHt9xV7G/fGxj54CDtY03vvDD')

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

Deno.serve({ port: 8002 }, app.fetch)
