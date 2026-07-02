import {
  CHUNK_TYPE,
  type EventSourceMessage,
  JsonEventSourceOpenAITransformer,
  type OpenAIStreamWriter,
} from "chat-base";
import json2md from "json2md";
import { OpenAI, YuanBao } from "./types.ts";

export class ChunkTransformer
  extends JsonEventSourceOpenAITransformer<YuanBao.CompletionChunk> {
  constructor(
    req: Response,
    config: OpenAI.ChatConfig,
    messages: OpenAI.Message[],
  ) {
    super(req, {
      model: config.model_name,
      messages,
    });
  }

  protected override shouldSkipEvent(event: EventSourceMessage): boolean {
    return /^[[a-z]/.test(event.data);
  }

  protected handleChunk(
    chunk: YuanBao.CompletionChunk,
    _event: EventSourceMessage,
    writer: OpenAIStreamWriter,
  ): void {
    switch (this.getChunkType(chunk)) {
      case CHUNK_TYPE.TEXT: {
        const textChunk = chunk as YuanBao.CompletionChunkText;
        if (textChunk.msg) writer.write({ content: textChunk.msg });
        return;
      }
      case CHUNK_TYPE.THINKING: {
        const thinkChunk = chunk as YuanBao.CompletionChunkThink;
        if (thinkChunk.content) {
          writer.write({ reasoningContent: thinkChunk.content });
        }
        return;
      }
      case CHUNK_TYPE.DEEPSEARCHING: {
        const deepChunk = chunk as YuanBao.CompletionChunkDeepSearch;
        const message = deepChunk.contents?.[0]?.msg;
        if (message) writer.write({ reasoningContent: message });
        return;
      }
      case CHUNK_TYPE.SEARCHING_DONE: {
        const searchChunk = chunk as YuanBao.CompletionChunkSearch;
        writer.write({ citations: searchChunk.docs.map((doc) => doc.url) });
        return;
      }
      default:
        this.renderChunk(chunk, writer);
        return;
    }
  }

  private renderChunk(
    chunk: YuanBao.CompletionChunk,
    writer: OpenAIStreamWriter,
  ): void {
    switch (chunk.type) {
      case "outline": {
        const chunkData = chunk as YuanBao.CompletionChunkOutline;
        writer.write({
          content: `# 研究大纲\n${
            chunkData.outlineList.map((item) => `- ${item}`).join("\n")
          }`,
        });
        return;
      }
      case "dividerLine": {
        const chunkData = chunk as YuanBao.CompletionChunkDivider;
        writer.write({ content: `\n# ${chunkData.dividerText}\n` });
        return;
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
        writer.write({ content: `\n# 相关组织及人物\n${tableMark}` });
        return;
      }
      default:
        if (!["components", "mindmap", "meta", "step"].includes(chunk.type)) {
          console.log(chunk);
        }
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
