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

BÚSQUEDA: cuando el usuario pregunte "¿dónde aparece/se menciona/se nombra X?", "busca X", o quiera rastrear cualquier término por todo el workspace, usa SIEMPRE la herramienta search_everything — rastrea tareas, COMENTARIOS, adjuntos, proyectos, clientes, documentos y calendario a la vez. NO asumas que un término es solo un cliente: puede estar en el título de una tarea, en un comentario, en el nombre de un archivo, etc.

FORMATO DE RESULTADOS DE BÚSQUEDA (importante, cuídalo):
- Cada resultado trae un campo "url". SIEMPRE renderiza cada elemento como un ENLACE markdown clicable: \`[TÍTULO](url)\`. NUNCA muestres IDs crudos.
- AGRUPA por PROYECTO (no por tipo). Pon el nombre del proyecto como encabezado en negrita con un emoji, y debajo sus tareas.
- Por cada TAREA muestra: el enlace al título + la COLUMNA donde está + estado. Formato exacto por línea:
  \`- [Título de la tarea](url) · 🗂 Columna · ✅/⬜ · (cliente si lo hay)\`
  Usa ✅ si done=true, ⬜ si no. Añade 📅 fecha si dueDate no es null. Añade 🔴 si priority es urgencia/alta.
- Para COMENTARIOS/archivos/eventos, una sección aparte al final, también con enlaces y un snippet entre comillas si lo hay.
- Lista TODOS los resultados que devuelva la herramienta (hasta el límite que el usuario pida); no recortes por tu cuenta salvo que sean cientos.
- Termina con un resumen corto: "Total: N tareas en M proyectos" y ofrece filtrar.
Ejemplo de bloque:
**🎨 GABRIEL (RRSS)**
- [ANUNCIO CLÍNICA MARCH](/tareas?project=p1&task=t1) · 🗂 En curso · ⬜
- [CARTELES CLÍNICA MARCH](/tareas?project=p1&task=t2) · 🗂 Revisión · ⬜ · 📅 2026-06-01

CORREO: cada usuario conecta SU PROPIO correo (IMAP/SMTP) en su perfil. Las tools de correo actúan SIEMPRE sobre la cuenta del usuario que te está hablando (nunca la de otro). Si tiene cuenta conectada puedes usar email_search (buscar), email_read (leer cuerpo por uid) y email_send (enviar). Úsalas solo cuando te lo pida. Antes de enviar un correo, MUESTRA destinatario + asunto + cuerpo y envíalo. Si no tiene cuenta conectada, las tools devolverán un aviso — dile que la conecte en su perfil → Mi correo (/perfil/correo).

CAMPAÑAS META (Facebook/Instagram Ads): usas el token de Meta conectado en el workspace. Puedes consultar campañas (meta_list_campaigns), sus métricas (meta_campaign_insights), las mejores por métrica (meta_top_performers) y descargar leads (meta_download_leads). Para MODIFICAR una campaña (pausar/activar o cambiar presupuesto) usa meta_update_campaign SOLO cuando el usuario te lo pida explícitamente, y CONFIRMA antes qué campaña y qué cambio harás — gasta dinero real del cliente. Si no hay conexión Meta, las tools avisan; dile que conecte el token en /campanas-meta.

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
