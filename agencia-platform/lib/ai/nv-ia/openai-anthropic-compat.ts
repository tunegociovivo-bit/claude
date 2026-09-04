import type Anthropic from "@anthropic-ai/sdk";
import { getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { logAiUsage } from "@/lib/ai/usage";

const FALLBACK_MODEL = "gpt-5";
const OPENAI_MAX_TOOLS = 128;

const FALLBACK_PRIORITY_TOOLS = [
  "meta_ads_download_leads",
  "create_xlsx_workbook",
  "list_task_files",
  "draft_whatsapp_file",
  "send_whatsapp_message",
  "add_task_comment"
];

function openAiCompatibleTools(params: Anthropic.MessageCreateParamsNonStreaming): any[] | undefined {
  const tools = params.tools ?? [];
  if (tools.length === 0) return undefined;

  const activeToolNames = new Set<string>();
  for (const message of params.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as any[]) {
      if (block?.type === "tool_use" && block.name) activeToolNames.add(String(block.name));
    }
  }

  const priority = new Set([...activeToolNames, ...FALLBACK_PRIORITY_TOOLS]);
  const chosen: any[] = [];
  const included = new Set<string>();
  const add = (tool: any) => {
    if (chosen.length >= OPENAI_MAX_TOOLS || included.has(tool.name)) return;
    chosen.push(tool);
    included.add(tool.name);
  };
  for (const tool of tools) if (priority.has(tool.name)) add(tool);
  for (const tool of tools) add(tool);

  return chosen.map((tool: any) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((block: any) => {
      if (block?.type === "text") return String(block.text ?? "");
      if (block?.type === "tool_result") {
        return typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? null);
      }
      if (block?.type === "image") return "[Imagen adjunta disponible en el contexto original]";
      if (block?.type === "document") return "[Documento adjunto disponible en el contexto original]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function anthropicParamsToOpenAi(params: Anthropic.MessageCreateParamsNonStreaming) {
  const messages: any[] = [];
  const system = textOf(params.system);
  if (system) messages.push({ role: "system", content: system });

  for (const message of params.messages) {
    const blocks = Array.isArray(message.content) ? message.content as any[] : null;
    if (message.role === "assistant" && blocks) {
      const content = blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n") || null;
      const toolCalls = blocks
        .filter((b) => b?.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
        }));
      messages.push({ role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    if (message.role === "user" && blocks?.some((b) => b?.type === "tool_result")) {
      const userText = blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
      if (userText) messages.push({ role: "user", content: userText });
      for (const block of blocks.filter((b) => b?.type === "tool_result")) {
        messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: textOf(block.content) || "{}" });
      }
      continue;
    }
    messages.push({ role: message.role, content: textOf(message.content) });
  }

  return {
    model: FALLBACK_MODEL,
    messages,
    max_completion_tokens: params.max_tokens,
    tools: openAiCompatibleTools(params)
  };
}

export function openAiResponseToAnthropic(json: any): Anthropic.Message {
  const choice = json?.choices?.[0];
  const message = choice?.message;
  if (!message || (!message.content && !Array.isArray(message.tool_calls))) {
    throw new Error("OpenAI fallback devolvió una respuesta vacía");
  }
  const content: any[] = [];
  if (typeof message.content === "string" && message.content.trim()) {
    content.push({ type: "text", text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    let input: any = {};
    try { input = JSON.parse(call?.function?.arguments || "{}"); } catch { input = {}; }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  return {
    id: json.id ?? `openai-${Date.now()}`,
    type: "message",
    role: "assistant",
    model: json.model ?? FALLBACK_MODEL,
    content,
    stop_reason: message.tool_calls?.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Number(json?.usage?.prompt_tokens) || 0,
      output_tokens: Number(json?.usage?.completion_tokens) || 0
    }
  } as Anthropic.Message;
}

export async function callOpenAiAsAnthropic(
  workspaceId: string,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  const apiKey = await getOpenAiKeyForWorkspace(workspaceId);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(anthropicParamsToOpenAi(params))
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI fallback ${response.status}: ${detail.slice(0, 300)}`);
  }
  const json = await response.json();
  const result = openAiResponseToAnthropic(json);
  logAiUsage({
    workspaceId,
    userId: null,
    projectId: null,
    feature: "sonia_agent_fallback",
    provider: "openai",
    model: result.model,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens
  }).catch(() => undefined);
  return result;
}

export function isAnthropicBillingError(error: any): boolean {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return message.includes("credit balance is too low") || message.includes("plans & billing");
}
