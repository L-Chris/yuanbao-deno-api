export type AssistantMessageContent = TextContent | ToolUse

export { parseAssistantMessage } from "./parse-assistant-message.ts"

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

export const toolUseNames = [
	"use_function_tool",
	"attempt_completion",
] as const

// Converts array of tool call names into a union type ("execute_command" | "read_file" | ...)
export type ToolUseName = (typeof toolUseNames)[number]

export const toolParamNames = [
	// "command",
	// "requires_approval",
	// "path",
	// "content",
	// "diff",
	// "regex",
	// "file_pattern",
	// "recursive",
	// "action",
	// "url",
	// "coordinate",
	// "text",
	// "server_name",
	// "uri",
	// "question",
	// "options",
	// "response",
	// "result",
	"tool_name",
	"arguments"
] as const

export type ToolParamName = (typeof toolParamNames)[number]

export interface ToolUse {
	type: "tool_use"
	name: ToolUseName
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
}
