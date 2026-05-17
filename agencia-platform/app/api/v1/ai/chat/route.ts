import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getAnthropicForWorkspace, AIDisabledError, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { toolDefs, runTool } from "@/lib/ai/chat-tools";

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string()
      })
    )
    .min(1)
    .max(40)
});

const SYSTEM = `Eres "Hub", el asistente IA de Agencia Hub — una plataforma interna de una agencia de marketing.

Hablas español por defecto (igualas el idioma del usuario si te habla en otro). Eres directo, breve y proactivo. Cuando el usuario te pide información sobre clientes, tareas, proyectos, documentos o eventos del workspace, USA las herramientas disponibles para obtener datos reales en lugar de inventar. Cuando creas tareas u otros recursos, confirma brevemente lo creado al final.

Si la respuesta es operativa (listar tareas, contar clientes, etc.) y no requiere matices, contesta en máximo 1-2 párrafos o una lista corta. Si te piden ayuda creativa (copy, ideas, briefings), sé generoso.

No expongas IDs internos al usuario salvo que los pida.`;

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let client: Anthropic;
  try {
    client = await getAnthropicForWorkspace(api.workspaceId);
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content
  }));

  // Loop agéntico: ejecutar tools hasta que el modelo termine
  for (let i = 0; i < 6; i++) {
    const resp = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: toolDefs as any,
      messages
    });

    if (resp.stop_reason !== "tool_use") {
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({ reply: text || "(sin respuesta)" });
    }

    // Ejecutar tool_use blocks
    messages.push({ role: "assistant", content: resp.content as any });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        const result = await runTool(block.name, block.input as any, {
          workspaceId: api.workspaceId,
          userId: api.userId
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({
    reply: "El asistente sigue trabajando — intenta acotar la pregunta o repítela."
  });
});
