export declare namespace OpenAI {
  interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool'
    type?: 'text' | 'image' | 'file'
    image?: string
    content: string | MessageContent[]
    tool_calls?: ToolCall[]
    tool_call_id?: string
  }

  interface MessageContent {
    type: 'text' | 'file' | 'image_url' | 'image'
    file_url?: {
      url: string
    }
    image_url?: {
      url: string
    }
    text?: string
  }

  interface CompletionChunk {
    id: string
    model: string
    object: string
    citations: string[]
    created: number
    choices: {
      index: number
      message?: {
        role: 'assistant' | 'user'
        content: string
        reasoning_content?: string
        tool_calls?: ToolCall[]
      }
      delta?: {
        role: 'assistant' | 'user'
        content: string
        reasoning_content?: string
        tool_calls?: ToolCall[]
      }
      finish_reason: null | 'stop' | 'tool_calls'
    }[]
    usage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
    error?: {
      message: string
      type: string
    }
  }

  interface Tool {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: {
        type: 'object'
        properties: Record<
          string,
          {
            type: string
            description: string
          }
        >
        required: string[]
        additionalProperties: boolean
      }
      strict: boolean
    }
  }

  interface ToolCall {
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }

  type ToolChoice = 'auto' | 'required'

  interface ChatConfig {
    chat_id: string
    chat_type: 't2t' | 't2v' | 't2i' | 'search' | 'artifacts'
    model_name: string
    response_format: {
      type: 'text' | 'json_schema'
      json_schema?: Record<string, any>
    }
    features: {
      thinking: boolean
      searching: boolean
      deepsearching: boolean
    }
    stream: boolean
    tools: Tool[]
    tool_choice: ToolChoice
    is_tool_calling: boolean
    is_tool_calling_done: boolean
  }
}

export declare namespace YuanBao {
  interface Message {
    role: OpenAI.Message['role']
    content: string | MessageContent[]
  }

  interface MessageContent {
    type: 'text' | 'file' | 'image_url' | 'image'
    file_url?: {
      url: string
    }
    image_url?: {
      url: string
    }
    text?: string
  }

  interface Attachment {
    id: string
    user_id: string
    hash: string | null
    filename: string
    data: Record<string, any>
    meta: {
      name: string
      content_type: string
      size: number
    }
    created_at: number
    updated_at: number
    type: 'image' | 'file'
  }

  interface AttachmentResponse {
    type: 'image' | 'file'
    id: string
    url: string
    image: string
    name: string
    status: 'uploaded'
    size: number
    error: string
    itemId: string
    file_type: string
    showType: 'image' | 'file'
  }

  type CompletionChunkStep = {
    type: 'step'
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
  }

  type CompletionChunkText = {
    type: 'text'
    msg: string
    isTitle?: boolean
  }

  type CompletionChunkThink = {
    type: 'think'
    title: string
    iconType: string
    content: string
  }

  type CompletionChunkSearch = {
    type: 'searchGuid'
    title: string
    subTitle: string
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
  }

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
  }

  type CompletionChunkComponent = {
    type: 'components'
    list: {
      type: 'step' | 'searchGuid' | 'outline' | 'text' | 'mindmap' | 'timeline' | 'relevantEvents' | 'relevantEntities' | 'card';
      steps?: { name: string }[];
      title?: {
        content?: string;
        form?: string;
      };
    }[]
  }

  type CompletionChunkOutline = {
    type: 'outline'
    outlineList: string[]
  }

  type CompletionChunkMindmap = {
    type: 'mindmap'
    url: string
    status: 'running' | 'success'
    urlHigh: string
  }

  type CompletionChunkTimeline = {
    type: 'timeline'
    timelineList: any[]
  }

  type CompletionChunkRelevantEntities = {
    type: 'relevantEntities'
    entityList: {
      name: string;
      type: string;
      desc: string;
      reference: number[];
    }[]
  }

  type CompletionChunkDivider = {
    type: 'dividerLine'
    dividerText: string
  }

  type CompletionChunk = CompletionChunkSearch | CompletionChunkStep | CompletionChunkText | CompletionChunkThink | CompletionChunkMeta | CompletionChunkComponent | CompletionChunkOutline | CompletionChunkMindmap | CompletionChunkTimeline | CompletionChunkRelevantEntities | CompletionChunkDivider

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
