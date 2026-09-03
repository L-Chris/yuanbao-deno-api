import {
  CHUNK_TYPE,
  type EventSourceMessage,
  MappedJsonEventSourceOpenAITransformer,
  type StreamAction,
} from "chat-base";
import json2md from "json2md";
import { OpenAI, YuanBao } from "./types.ts";

export class ChunkTransformer
  extends MappedJsonEventSourceOpenAITransformer<YuanBao.CompletionChunk> {
  constructor(
    req: Response,
    config: OpenAI.ChatConfig,
    messages: OpenAI.Message[],
  ) {
    super(req, {
      model: config.model_name,
      messages,
      mapChunk: (chunk) => this.mapChunk(chunk),
      shouldSkipEvent: (event) => this.skipNonJsonEvent(event),
    });
  }

  private skipNonJsonEvent(event: EventSourceMessage): boolean {
    return /^[[a-z]/.test(event.data);
  }

  private mapChunk(chunk: YuanBao.CompletionChunk): StreamAction {
    switch (this.getChunkType(chunk)) {
      case CHUNK_TYPE.TEXT: {
        const textChunk = chunk as YuanBao.CompletionChunkText;
        return textChunk.msg
          ? { type: "content", content: textChunk.msg }
          : { type: "ignore" };
      }
      case CHUNK_TYPE.THINKING: {
        const thinkChunk = chunk as YuanBao.CompletionChunkThink;
        return thinkChunk.content
          ? { type: "reasoning", content: thinkChunk.content }
          : { type: "ignore" };
      }
      case CHUNK_TYPE.DEEPSEARCHING: {
        const deepChunk = chunk as YuanBao.CompletionChunkDeepSearch;
        const message = deepChunk.contents?.[0]?.msg;
        return message
          ? { type: "reasoning", content: message }
          : { type: "ignore" };
      }
      case CHUNK_TYPE.SEARCHING_DONE: {
        const searchChunk = chunk as YuanBao.CompletionChunkSearch;
        return {
          type: "citations",
          citations: searchChunk.docs.map((doc) => doc.url),
        };
      }
      default:
        return this.renderChunk(chunk);
    }
  }

  private renderChunk(chunk: YuanBao.CompletionChunk): StreamAction {
    switch (chunk.type) {
      case "outline": {
        const chunkData = chunk as YuanBao.CompletionChunkOutline;
        return {
          type: "content",
          content: `# 研究大纲\n${
            chunkData.outlineList.map((item) => `- ${item}`).join("\n")
          }`,
        };
      }
      case "dividerLine": {
        const chunkData = chunk as YuanBao.CompletionChunkDivider;
        return { type: "content", content: `\n# ${chunkData.dividerText}\n` };
      }
      case "relevantEntities": {
        const chunkData = chunk as YuanBao.CompletionChunkRelevantEntities;
        const tableMark = json2md({
          table: {
            headers: ["name", "desc"],
            rows: chunkData.entityList.map((item) => ({
              name: this.formatLink(item.name),
              desc: item.desc,
            })),
          },
        });
        return { type: "content", content: `\n# 相关组织及人物\n${tableMark}` };
      }
      default:
        if (!["components", "mindmap", "meta", "step"].includes(chunk.type)) {
          console.log(chunk);
        }
        return { type: "ignore" };
    }
  }

  private getChunkType(chunk: YuanBao.CompletionChunk): CHUNK_TYPE {
    if (chunk.type === "think") return CHUNK_TYPE.THINKING;
    if (chunk.type === "deepSearch") return CHUNK_TYPE.DEEPSEARCHING;
    if (chunk.type === "text") return CHUNK_TYPE.TEXT;
    if (chunk.type === "searchGuid") return CHUNK_TYPE.SEARCHING_DONE;
    if (chunk.type === "meta") return CHUNK_TYPE.START;
    return CHUNK_TYPE.NONE;
  }

  private formatLink(desc: string): string {
    return desc.replace(
      /\[(\d+(?:,\d+)*)\]\(@ref\)/g,
      (_, numbers: string) =>
        numbers.split(",").map((number) => `[${number}]`).join(""),
    );
  }
}
