/**
 * POST /api/v1/sonia-chat
 *
 * Pair programming chat con Sonia en tiempo real. Diferente del agent
 * loop (que ejecuta tools y modifica state) — este es un Q&A para que
 * David le hable a Sonia conversacionalmente:
 *   - "¿cómo va RS Advocats?"
 *   - "explícame qué hace la task X"
 *   - "¿qué tasks tienen prioridad URGENTE hoy?"
 *   - "¿tengo créditos OK en Anthropic?"
 *
 * Body: { messages: [{role: "user"|"assistant", content: string}], voice?: boolean }
 *
 * Devuelve la respuesta como JSON simple (sin streaming todavía, por
 * simplicidad; añadir SSE en V2 si hace falta).
 *
 * Contexto inyectado automáticamente:
 *   - Tasks RUNNING / PENDING / REQUIRES_HUMAN (top 20)
 *   - Últimos 10 runs finalizados
 *   - Workspace name + miembros
 *
 * Modelo: Haiku 4.5 (rápido y barato) — el chat necesita latencia baja.
 *
 * No usa tools. Si Sonia necesita info que no está en el contexto,
 * sugiere al user que ejecute una task concreta.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { logAiUsage } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_MODEL = "claude-haiku-4-5";
const MAX_MESSAGES = 20;
const MAX_TOKENS_OUT = 1200;

type ChatMessage = { role: "user" | "assistant"; content: string };

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    throw new ApiError(400, "validation_error", "messages: array requerido");
  }
  const messages: ChatMessage[] = body.messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-MAX_MESSAGES);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new ApiError(400, "validation_error", "El último mensaje debe ser del usuario");
  }

  // Construir contexto del workspace
  const [activeRuns, recentTasks, workspace] = await Promise.all([
    prisma.aiAgentRun.findMany({
      where: {
        workspaceId: api.workspaceId,
        status: { in: ["PENDING", "RUNNING", "REQUIRES_HUMAN"] }
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        taskId: true,
        status: true,
        startedAt: true,
        stepsCount: true,
        summary: true
      }
    }),
    prisma.task.findMany({
      where: {
        workspaceId: api.workspaceId,
        deletedAt: null,
        completedAt: null
      } as any,
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 25,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        client: { select: { name: true } } as any,
        project: { select: { name: true } }
      } as any
    }),
    prisma.workspace.findUnique({
      where: { id: api.workspaceId },
      select: { name: true }
    })
  ]);

  // Resúmenes legibles para el system prompt
  const runsContext = activeRuns.length
    ? activeRuns
        .map(
          (r) =>
            `- run ${r.id.slice(-8)} task=${r.taskId.slice(-8)} status=${r.status} steps=${r.stepsCount}${r.summary ? ` | "${r.summary.slice(0, 100)}"` : ""}`
        )
        .join("\n")
    : "(ningún run activo)";
  const tasksContext = recentTasks.length
    ? recentTasks
        .map((t: any) => {
          const due = t.dueDate ? ` due=${new Date(t.dueDate).toISOString().slice(0, 10)}` : "";
          const cli = t.client?.name ? ` · ${t.client.name}` : "";
          return `- ${t.priority} · ${t.title.slice(0, 60)}${cli} · ${t.project?.name ?? "?"}${due}`;
        })
        .join("\n")
    : "(sin tasks pendientes)";

  const systemPrompt = `Eres Sonia, la asistente IA de la agencia "${workspace?.name ?? "Negocio Vivo"}". David está hablando contigo en tiempo real desde un chat dentro del Hub.

ESTILO:
- Castellano natural, conciso, directo.
- 1-3 frases por respuesta salvo que David pida explícitamente más detalle.
- Sin emojis salvo que aporten claridad (✅ tarea ok, ⚠️ algo a revisar).
- Si no sabes algo (datos que no tienes), dilo y sugiere cómo conseguirlo.

CONTEXTO ACTUAL DEL WORKSPACE:

Runs en curso (Sonia trabajando ahora mismo):
${runsContext}

Tasks pendientes (top 25 ordenadas por prioridad/due):
${tasksContext}

LIMITACIONES:
- Este chat es solo para CONSULTA. No puedes ejecutar tools (crear/modificar nada) desde aquí. Para acciones reales, David te lo pide creando una task en el Hub y dándole "Pedir a Sonia".
- Si David te pide hacer algo accionable ("crea una campaña", "manda un email"), responde explicando cómo lo iniciaría desde una task — no le digas "no puedo", dile el camino.

Sé útil. David te tiene aquí para enterarse rápido sin tener que abrir 5 pantallas.`;

  const client = await getAnthropicForWorkspace(api.workspaceId);
  let resp;
  try {
    resp = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: MAX_TOKENS_OUT,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json(
      { error: { code: "anthropic_error", message: msg.slice(0, 300) } },
      { status: 502 }
    );
  }

  const text = resp.content
    .map((b) => (b.type === "text" ? (b as any).text : ""))
    .join("")
    .trim();

  logAiUsage({
    workspaceId: api.workspaceId,
    userId: api.userId,
    feature: "sonia_chat",
    provider: "anthropic",
    model: CHAT_MODEL,
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0
  }).catch(() => {});

  return NextResponse.json({
    role: "assistant",
    content: text,
    tokens: {
      input: resp.usage?.input_tokens ?? 0,
      output: resp.usage?.output_tokens ?? 0
    }
  });
});
