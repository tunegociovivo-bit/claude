/**
 * Llamadas de voz de Sonia vía Vapi (vapi.ai). El número y el asistente
 * "Sonia" (persona, voz, guion) se configuran en el panel de Vapi; aquí solo
 * disparamos llamadas y recogemos el resultado por webhook.
 *
 * Config en Workspace.settings.integrations.voice:
 *   { apiKeyEnc, phoneNumberId, assistantId }
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

export class VoiceNotConfiguredError extends Error {
  constructor(msg = "Llamadas de voz no configuradas. Añade la API key de Vapi, el phoneNumberId y el assistantId en /admin/voz.") {
    super(msg);
  }
}

export type VoiceConfig = {
  apiKey: string | null;
  phoneNumberId: string | null;
  assistantId: string | null;
  webhookToken: string | null;
};

export async function getVoiceConfig(workspaceId: string): Promise<VoiceConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const v = (ws?.settings as any)?.integrations?.voice ?? {};
  const apiKey = v.apiKeyEnc ? decryptSecret(v.apiKeyEnc) : process.env.VAPI_API_KEY ?? null;
  return {
    apiKey: apiKey || null,
    phoneNumberId: v.phoneNumberId ?? process.env.VAPI_PHONE_NUMBER_ID ?? null,
    assistantId: v.assistantId ?? process.env.VAPI_ASSISTANT_ID ?? null,
    webhookToken: v.webhookTokenEnc ? decryptSecret(v.webhookTokenEnc) : v.webhookToken ?? null
  };
}

/** Normaliza un teléfono a formato E.164 básico (+34… si parece español). */
export function normalizePhone(raw: string): string {
  let n = raw.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return n;
  if (n.length === 9) return `+34${n}`; // móvil/fijo español sin prefijo
  if (n.startsWith("34")) return `+${n}`;
  return n.startsWith("+") ? n : `+${n}`;
}

/**
 * Inicia una llamada saliente. `goal` se pasa como variable al asistente
 * de Vapi (usa {{goal}} en su prompt) para guiar la conversación. Si se
 * indica `customerName`, se saluda a la persona por su nombre en la
 * primera frase (genera confianza) y queda disponible como {{customerName}}.
 */
export async function startVoiceCall(opts: {
  workspaceId: string;
  toNumber: string;
  goal: string;
  customerName?: string;
  userId?: string;
  /** Tarea de origen: la grabación/resumen se adjuntará a ELLA al colgar. */
  taskId?: string;
  clientId?: string;
  variables?: Record<string, string>;
}): Promise<{ id: string; providerCallId: string | null }> {
  const cfg = await getVoiceConfig(opts.workspaceId);
  if (!cfg.apiKey || !cfg.phoneNumberId || !cfg.assistantId) throw new VoiceNotConfiguredError();
  const to = normalizePhone(opts.toNumber);

  const name = opts.customerName?.trim();
  const variableValues: Record<string, string> = { goal: opts.goal, ...(opts.variables ?? {}) };
  const assistantOverrides: any = { variableValues };
  if (name) {
    variableValues.customerName = name;
    // Solo el nombre de pila para el saludo ("Hola, ¿hablo con David?") —
    // suena más natural y cercano que el nombre completo. El resto del
    // guion/persona (voz, tono) sigue viniendo del asistente de Vapi.
    const firstName = name.split(/\s+/)[0];
    assistantOverrides.firstMessage = `Hola, ¿hablo con ${firstName}?`;
  }

  const resp = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      phoneNumberId: cfg.phoneNumberId,
      assistantId: cfg.assistantId,
      customer: { number: to, ...(name ? { name } : {}) },
      assistantOverrides
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Vapi ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const providerCallId = data?.id ?? null;

  const call = await prisma.voiceCall.create({
    data: {
      workspaceId: opts.workspaceId,
      provider: "vapi",
      providerCallId,
      toNumber: to,
      goal: opts.goal,
      status: data?.status ?? "queued",
      createdById: opts.userId ?? null,
      taskId: opts.taskId ?? null,
      clientId: opts.clientId ?? null
    }
  });
  return { id: call.id, providerCallId };
}

/**
 * Consulta el estado de una llamada en Vapi por su id de proveedor. Útil para
 * verificar que la llamada arrancó de verdad y detectar fallos inmediatos
 * (números no internacionales, sin saldo, transporte, etc.).
 */
export async function getVapiCallStatus(
  workspaceId: string,
  providerCallId: string
): Promise<{ status: string | null; endedReason: string | null; endedMessage: string | null } | null> {
  const cfg = await getVoiceConfig(workspaceId);
  if (!cfg.apiKey) return null;
  try {
    const r = await fetch(`https://api.vapi.ai/call/${providerCallId}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      status: d?.status ?? null,
      endedReason: d?.endedReason ?? null,
      endedMessage: d?.endedMessage ?? null
    };
  } catch {
    return null;
  }
}

/**
 * Procesa el webhook de Vapi (end-of-call-report u otros status). Actualiza
 * la VoiceCall con transcripción, resumen y datos. Devuelve si se aplicó.
 */
export async function handleVapiWebhook(payload: any): Promise<{ ok: boolean }> {
  const msg = payload?.message ?? payload;
  const call = msg?.call ?? payload?.call;
  const providerCallId = call?.id ?? msg?.callId ?? null;
  if (!providerCallId) return { ok: false };
  const existing = await prisma.voiceCall.findFirst({ where: { providerCallId } });
  if (!existing) return { ok: false };

  const type = msg?.type;
  const data: any = {};
  if (type === "status-update" && msg?.status) data.status = msg.status;
  if (type === "end-of-call-report" || msg?.endedReason) {
    data.status = "ended";
    if (msg?.endedReason) data.endedReason = msg.endedReason;
    if (typeof msg?.transcript === "string") data.transcript = msg.transcript.slice(0, 20000);
    const summary = msg?.summary ?? msg?.analysis?.summary;
    if (typeof summary === "string") data.summary = summary.slice(0, 4000);
    const structured = msg?.analysis?.structuredData ?? msg?.artifact?.structuredData;
    if (structured) data.structured = structured;
    const rec = msg?.recordingUrl ?? msg?.artifact?.recordingUrl ?? call?.recordingUrl;
    if (rec) data.recordingUrl = rec;
    if (typeof call?.startedAt === "string" && typeof call?.endedAt === "string") {
      data.durationSec = Math.max(0, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000));
    }
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.voiceCall.update({ where: { id: existing.id }, data });

  // Crear la tarea en "Reuniones y llamadas" SOLO cuando ya tenemos contenido
  // (transcripción o resumen). Vapi manda primero un "ended" sin transcripción
  // y luego el end-of-call-report con todo; si creábamos la tarea en el primer
  // evento, salía vacía y el segundo ya no la rellenaba (taskId puesto).
  const fresh = await prisma.voiceCall.findUnique({ where: { id: existing.id } });
  const hasContent = !!(fresh?.transcript?.trim() || fresh?.summary?.trim());
  if (fresh && hasContent && !fresh.taskId) {
    try {
      await createCallTask(fresh);
    } catch (e) {
      console.error("[voice] crear tarea de llamada falló:", (e as Error).message);
    }
  } else if (fresh && hasContent && fresh.taskId) {
    // La llamada salió de una tarea concreta (Sonia la propuso ahí): adjunta
    // la grabación + resumen/transcripción a ESA tarea para poder revisarla.
    try {
      await attachCallResultToTask(fresh);
    } catch (e) {
      console.error("[voice] adjuntar resultado a la tarea de origen falló:", (e as Error).message);
    }
  }

  // Confirmar/actualizar el evento de calendario ligado a esta llamada
  // (reserva/cita que gestionó Sonia). Solo cuando la llamada ya terminó.
  const ended = fresh?.status === "ended" || isFailedCall(fresh?.status, fresh?.endedReason) || hasContent;
  if (fresh && ended) {
    try {
      await reconcileLinkedEvent(fresh);
    } catch (e) {
      console.error("[voice] reconciliar evento de llamada falló:", (e as Error).message);
    }
  }
  return { ok: true };
}

/** ¿La llamada acabó en fallo (no contestan, ocupado, error, buzón)? */
function isFailedCall(status?: string | null, reason?: string | null): boolean {
  const r = (reason ?? "").toLowerCase();
  if (status === "failed") return true;
  return /error|fail|forbidden|invalid|no-?answer|did-not-answer|busy|declined|voicemail|rejected|unallocated/.test(r);
}

/**
 * Vincula el resultado real de la llamada con el evento de calendario que
 * Sonia creó para la reserva/cita: añade una nota de resultado a la
 * descripción y avisa al usuario que pidió la gestión. Idempotente (no
 * duplica si ya se anotó).
 */
async function reconcileLinkedEvent(call: {
  id: string;
  workspaceId: string;
  status: string;
  endedReason: string | null;
  summary: string | null;
  createdById: string | null;
}): Promise<void> {
  const event = await prisma.calendarEvent.findFirst({ where: { voiceCallId: call.id } as any });
  if (!event) return;
  // Idempotencia: si ya anotamos el resultado, no repetir.
  if (event.description && /(✅ Llamada|⚠️ Llamada)/.test(event.description)) return;

  const failed = isFailedCall(call.status, call.endedReason);
  const summary = call.summary?.trim();
  const stamp = new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" } as any);
  const note = failed
    ? `⚠️ Llamada NO completada (${call.endedReason ?? call.status}). Reserva SIN confirmar — revísala.`
    : `✅ Llamada realizada${summary ? `. Resultado: ${summary}` : "."}`;
  const newDesc = [event.description?.trim(), `— ${note} (${stamp})`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
  await prisma.calendarEvent.update({ where: { id: event.id }, data: { description: newDesc } });

  // Reflejar el cambio en Google Calendar si está sincronizado.
  try {
    const { pushEventIfConnected } = await import("@/lib/integrations/google-calendar/sync");
    await pushEventIfConnected(event.id);
  } catch {
    /* best-effort */
  }

  if (call.createdById) {
    await prisma.notification
      .create({
        data: {
          userId: call.createdById,
          type: failed ? "ai_call_failed" : "ai_call_done",
          body: failed
            ? `⚠️ La llamada para "${event.title}" no se completó (${call.endedReason ?? "sin contestar"}). La reserva NO está confirmada.`
            : `✅ Llamada hecha para "${event.title}".${summary ? ` ${summary.slice(0, 140)}` : ""}`,
          link: "/calendario"
        }
      })
      .catch(() => {});
  }
}

/** Normaliza para comparar etiquetas de columna (minúsculas, sin acentos). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Busca el proyecto + columna "Reuniones y llamadas" del workspace. */
async function findReunionesColumn(
  workspaceId: string
): Promise<{ projectId: string; columnId: string } | null> {
  const projects = await prisma.project.findMany({
    where: { workspaceId, archived: false } as any,
    select: { id: true, kanbanColumns: true }
  });
  let partial: { projectId: string; columnId: string } | null = null;
  for (const p of projects) {
    const cols = Array.isArray((p as any).kanbanColumns) ? ((p as any).kanbanColumns as any[]) : [];
    for (const c of cols) {
      const label = norm(String(c?.label ?? ""));
      if (!label) continue;
      if (label.includes("reunion") && label.includes("llamad")) {
        return { projectId: p.id, columnId: String(c.id) };
      }
      if (!partial && (label.includes("reunion") || label.includes("llamad"))) {
        partial = { projectId: p.id, columnId: String(c.id) };
      }
    }
  }
  return partial;
}

/**
 * Crea la tarea de la llamada (resumen + transcripción como TipTap) en la
 * columna "Reuniones y llamadas", adjunta el audio (si hay storage) y enlaza
 * la VoiceCall.taskId.
 */
/**
 * Adjunta el resultado de una llamada (resumen + transcripción + grabación)
 * a la TAREA DE ORIGEN (la que la propuso), en vez de crear una nueva. Para
 * que el usuario compruebe cómo lo hizo Sonia. Idempotente por call.id.
 */
async function attachCallResultToTask(call: {
  id: string;
  workspaceId: string;
  toNumber: string;
  goal: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  createdById: string | null;
  durationSec: number | null;
  taskId: string | null;
}): Promise<void> {
  if (!call.taskId) return;
  const marker = `voicecall:${call.id}`;
  const already = await prisma.comment.findFirst({
    where: { workspaceId: call.workspaceId, targetType: "TASK", targetId: call.taskId, body: { contains: marker } },
    select: { id: true }
  });
  if (already) return; // ya adjuntado

  const ws = await prisma.workspace.findUnique({ where: { id: call.workspaceId }, select: { settings: true } });
  const authorId = call.createdById ?? ((ws?.settings as any)?.aiAgent?.userId as string | undefined);

  const dur = call.durationSec ? ` (${Math.floor(call.durationSec / 60)}m${call.durationSec % 60}s)` : "";
  const body =
    `📞 Resultado de la llamada a ${call.toNumber}${dur}\n\n` +
    (call.summary?.trim() ? `**Resumen:** ${call.summary.trim()}\n\n` : "") +
    (call.recordingUrl ? `🎧 Grabación: ${call.recordingUrl}\n\n` : "") +
    (call.transcript?.trim() ? `**Transcripción:**\n${call.transcript.trim().slice(0, 6000)}\n\n` : "") +
    `<!-- ${marker} -->`;
  if (authorId) {
    await prisma.comment.create({
      data: { workspaceId: call.workspaceId, authorId, targetType: "TASK", targetId: call.taskId, body }
    });
  }

  // Descarga la grabación y la sube como adjunto de la tarea (mismo patrón
  // que createCallTask).
  if (call.recordingUrl) {
    try {
      const { isStorageEnabled, uploadBuffer, buildS3Key } = await import("@/lib/storage/r2");
      if (isStorageEnabled()) {
        const r = await fetch(call.recordingUrl, { signal: AbortSignal.timeout(30000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const ext = call.recordingUrl.includes(".mp3") ? "mp3" : "wav";
          const mime = ext === "mp3" ? "audio/mpeg" : "audio/wav";
          const s3Key = buildS3Key({
            workspaceId: call.workspaceId,
            targetType: "task",
            targetId: call.taskId,
            filename: `llamada-${call.id}.${ext}`
          });
          await uploadBuffer({ s3Key, body: buf, contentType: mime });
          await prisma.file.create({
            data: {
              workspaceId: call.workspaceId,
              name: `Llamada ${call.toNumber}.${ext}`,
              mimeType: mime,
              sizeBytes: buf.length,
              s3Key,
              targetType: "TASK",
              targetId: call.taskId,
              uploadedBy: call.createdById ?? undefined
            }
          });
        }
      }
    } catch (e) {
      console.warn("[voice] adjuntar audio a tarea de origen falló (queda el enlace en el comentario):", (e as Error).message);
    }
  }
}

async function createCallTask(call: {
  id: string;
  workspaceId: string;
  toNumber: string;
  goal: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  clientId: string | null;
  createdById: string | null;
  durationSec: number | null;
}): Promise<void> {
  const target = await findReunionesColumn(call.workspaceId);
  if (!target) {
    console.warn("[voice] no encontré columna 'Reuniones y llamadas' en ningún proyecto; no creo tarea.");
    return;
  }

  const fecha = new Date().toLocaleString("es-ES", { dateStyle: "short", timeString: undefined as any } as any);
  const dur = call.durationSec ? ` · ${Math.floor(call.durationSec / 60)}m${call.durationSec % 60}s` : "";
  const title = `📞 Llamada ${call.toNumber} — ${fecha}${dur}`;

  // Descripción como documento TipTap (resumen + transcripción).
  const content: any[] = [];
  if (call.goal) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Objetivo" }] });
    content.push({ type: "paragraph", content: [{ type: "text", text: call.goal }] });
  }
  content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Resumen / puntos clave" }] });
  content.push({
    type: "paragraph",
    content: [{ type: "text", text: call.summary?.trim() || "Sin resumen disponible." }]
  });
  if (call.recordingUrl) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Audio" }] });
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Escuchar grabación",
          marks: [{ type: "link", attrs: { href: call.recordingUrl } }]
        }
      ]
    });
  }
  content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Transcripción" }] });
  const lines = (call.transcript ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: "(sin transcripción)" }] });
  } else {
    for (const line of lines) {
      content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }
  const description = JSON.stringify({ type: "doc", content });

  const project = await prisma.project.findUnique({
    where: { id: target.projectId },
    select: { clientId: true }
  });

  const task = await prisma.task.create({
    data: {
      workspaceId: call.workspaceId,
      projectId: target.projectId,
      clientId: call.clientId ?? project?.clientId ?? null,
      title: title.slice(0, 250),
      description,
      status: target.columnId,
      priority: "MEDIUM"
    } as any
  });

  await prisma.voiceCall.update({ where: { id: call.id }, data: { taskId: task.id } });

  // Adjuntar el audio como File (descarga del recording → R2).
  if (call.recordingUrl) {
    try {
      const { isStorageEnabled, uploadBuffer, buildS3Key } = await import("@/lib/storage/r2");
      if (isStorageEnabled()) {
        const r = await fetch(call.recordingUrl, { signal: AbortSignal.timeout(30000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const ext = call.recordingUrl.includes(".mp3") ? "mp3" : "wav";
          const mime = ext === "mp3" ? "audio/mpeg" : "audio/wav";
          const s3Key = buildS3Key({
            workspaceId: call.workspaceId,
            targetType: "task",
            targetId: task.id,
            filename: `llamada-${Date.now()}.${ext}`
          });
          await uploadBuffer({ s3Key, body: buf, contentType: mime });
          await prisma.file.create({
            data: {
              workspaceId: call.workspaceId,
              name: `Llamada ${call.toNumber}.${ext}`,
              mimeType: mime,
              sizeBytes: buf.length,
              s3Key,
              targetType: "TASK",
              targetId: task.id,
              uploadedBy: call.createdById ?? undefined
            }
          });
        }
      }
    } catch (e) {
      console.warn("[voice] adjuntar audio falló (queda el enlace en la descripción):", (e as Error).message);
    }
  }
}
