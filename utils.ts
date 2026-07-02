import {
  BracketToolProtocol,
  extractJsonFromContent,
  safeJsonParse,
  uuid,
} from "chat-base";
import { OpenAI, YuanBao } from "./types.ts";

export { extractJsonFromContent, uuid };
export const safeJSONParse = safeJsonParse;

export function mergeMessages(
  config: OpenAI.ChatConfig,
  data: OpenAI.Message[],
  urls: YuanBao.Attachment[] = [],
): YuanBao.Message[] {
  const systemMessages = data.filter((message) => message.role === "system");
  const toolProtocol = new BracketToolProtocol();

  if (systemMessages.length === 0 && config.tools.length > 0) {
    systemMessages.push({
      role: "system",
      content: toolProtocol.buildSystemPrompt(
        config.tools,
        config.tool_choice,
      ),
    });
  }

  const content = data.filter((message) => message.role !== "system").reduce(
    (previous: string, message) => {
      if (Array.isArray(message.content)) {
        return message.content.reduce((current, part) => {
          if (part.type !== "text") return current;
          return current +
            `<message>${message.role || "user"}\n${part.text}</message>\n`;
        }, previous);
      }

      if (message.role === "assistant" && message.tool_calls?.length) {
        return previous;
      }

      if (message.role === "tool") {
        const toolCalls = data.find((item) =>
          item.tool_calls?.length && item.role === "assistant"
        )?.tool_calls || [];
        const toolName = toolCalls.find((item) =>
          item.id === message.tool_call_id
        )?.function.name || message.tool_call_id;
        return previous +
          `<message>user\n[ToolResults]\n[Result:${toolName}]\n[ToolResult]\n${message.content}\n[/ToolResult]\n[/Result]\n[/ToolResults]</message>\n`;
      }

      return previous +
        `<message>${message.role || "user"}\n${message.content}</message>\n`;
    },
    "",
  );

  return [
    ...systemMessages,
    {
      role: "user",
      content: [
        {
          text: content,
          type: "text",
        },
        ...urls.map((item) => ({ type: item.type, image: item.id })),
      ],
    },
  ];
}
