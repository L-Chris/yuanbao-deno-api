import type { OpenAI } from "chat-base";

export type { OpenAI };

export declare namespace YuanBao {
  interface Cookies {
    token: string;
    agentId: string;
    hy_user: string;
  }

  interface Message {
    role: OpenAI.Message["role"];
    content: string | MessageContent[];
    [key: string]: unknown;
  }

  interface MessageContent extends OpenAI.MessageContent {}

  interface Attachment {
    id: string;
    user_id: string;
    hash: string | null;
    filename: string;
    data: Record<string, unknown>;
    meta: {
      name: string;
      content_type: string;
      size: number;
    };
    created_at: number;
    updated_at: number;
    type: "image" | "file";
  }

  interface AttachmentResponse {
    type: "image" | "file";
    id: string;
    url: string;
    image: string;
    name: string;
    status: "uploaded";
    size: number;
    error: string;
    itemId: string;
    file_type: string;
    showType: "image" | "file";
  }

  type CompletionChunkStep = {
    type: "step";
    msg?: string;
    scene?: string;
    index?: number;
    writeExtend?: {
      fileName: string;
      docEditable: boolean;
      fileType: string;
      outline: string;
      templateId: string;
    };
  };

  type CompletionChunkText = {
    type: "text";
    msg: string;
    isTitle?: boolean;
  };

  type CompletionChunkDeepSearch = {
    type: "deepSearch";
    title: string;
    iconType: string;
    contents: {
      type: "text";
      componentId: string;
      msg: string;
      toolCallName: string;
      state: number;
      docs: unknown;
    }[];
  };

  type CompletionChunkThink = {
    type: "think";
    title: string;
    iconType: string;
    content: string;
  };

  type CompletionChunkSearch = {
    type: "searchGuid";
    title: string;
    subTitle: string;
    footnote: string;
    prompt: string;
    botPrompt: string;
    entranceIndex: number;
    messageId: string;
    docs: SearchResult[];
    hitDeepMode: boolean;
    hitHelpDraw: boolean;
    hitDrawMore: boolean;
    hitSearchAIImg: boolean;
    topic: string;
    count: number;
    deepModeCid: string;
    aiImageTotal: number;
    realImageTotal: number;
  };

  type CompletionChunkMeta = {
    type: "meta";
    messageId: string;
    index: number;
    replyId: string;
    replyIndex: number;
    traceId: string;
    guideId: number;
    ic: number;
    unSupportRepeat: boolean;
    pluginID: string;
  };

  type CompletionChunkComponent = {
    type: "components";
    list: {
      type:
        | "step"
        | "searchGuid"
        | "outline"
        | "text"
        | "mindmap"
        | "timeline"
        | "relevantEvents"
        | "relevantEntities"
        | "card";
      steps?: { name: string }[];
      title?: {
        content?: string;
        form?: string;
      };
    }[];
  };

  type CompletionChunkOutline = {
    type: "outline";
    outlineList: string[];
  };

  type CompletionChunkMindmap = {
    type: "mindmap";
    url: string;
    status: "running" | "success";
    urlHigh: string;
  };

  type CompletionChunkTimeline = {
    type: "timeline";
    timelineList: unknown[];
  };

  type CompletionChunkRelevantEntities = {
    type: "relevantEntities";
    entityList: {
      name: string;
      type: string;
      desc: string;
      reference: number[];
    }[];
  };

  type CompletionChunkDivider = {
    type: "dividerLine";
    dividerText: string;
  };

  type CompletionChunk =
    | CompletionChunkDeepSearch
    | CompletionChunkSearch
    | CompletionChunkStep
    | CompletionChunkText
    | CompletionChunkThink
    | CompletionChunkMeta
    | CompletionChunkComponent
    | CompletionChunkOutline
    | CompletionChunkMindmap
    | CompletionChunkTimeline
    | CompletionChunkRelevantEntities
    | CompletionChunkDivider;

  interface SearchResult {
    index: number;
    docId: string;
    title: string;
    url: string;
    sourceType: string;
    sourceName: string;
    quote: string;
    publish_time: string;
    icon_url: string;
    web_site_name: string;
  }

  interface Model {
    id: string;
    name: string;
    object: string;
    created: number;
    owned_by: string;
    preset: boolean;
    action_ids: string[];
    info: {
      id: string;
      user_id: string;
      base_model_id: null;
      name: string;
      meta: {
        profile_image_url: string;
        description: string;
        short_description: string;
        max_context_length: number;
        max_generation_length: number;
        is_single_round?: number;
        chat_type: string[];
        modality: string[];
        capabilities: {
          vision: boolean;
          document: boolean;
          video: boolean;
          citations: boolean;
        };
      };
      params: {
        model_type: string;
        max_ref_token: number;
        max_input_tokens: number;
        enable_reasoning_content?: boolean;
        system?: string;
        seed?: number;
        ignore_single_turn?: boolean;
      };
      access_control: null;
      is_active: boolean;
      is_visitor_active: boolean;
      updated_at: number;
      created_at: number;
    };
  }
}
