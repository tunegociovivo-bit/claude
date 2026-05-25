/**
 * POST /api/v1/editorial/generate-single
 *
 * Genera UNA publicación con IA a partir de un título/tema concreto,
 * fecha y formato que el usuario eligió en el modal "Nueva publicación"
 * del calendario. Misma infraestructura de jobs en background que
 * generate-month — devuelve { jobId } y el cliente hace polling.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateMonth } from "@/lib/editorial/generate-month";
import { generatePostVideo } from "@/lib/editorial/generate-video";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

/** Formatos que se generan como VÍDEO (pipeline tomas + voz + subtítulos)
 *  en vez de como imagen estática. */
const VIDEO_FORMATS = new Set(["video", "reel", "story"]);

const schema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1).max(200),
  format: z.string().min(1).default("imagen"),
  networks: z.array(z.string()).min(1).default(["instagram"]),
  scheduledFor: z.string().datetime(),
  copyLength: z.number().int().min(0).max(100).default(50),
  perNetworkCopy: z.boolean().default(true),
  extraGuidance: z.string().optional(),
  imageIncludeHint: z.string().optional(),
  imageAvoidHint: z.string().optional(),
  useRosterPersons: z.array(z.string()).optional(),
  status: z.enum(["DRAFT", "REVIEW"]).default("DRAFT"),
  // Siempre generamos imagen — el usuario quiso quitar el checkbox.
  imageQuality: z.enum(["low", "medium", "high"]).default("medium")
});

type Params = z.infer<typeof schema>;

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const job = await prisma.backgroundJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId ?? null,
      kind: "editorial.generate_single",
      status: "PENDING",
      progressPct: 0,
      progressMsg: "En cola…",
      request: parsed.data as any
    }
  });

  runJobAsync(job.id, api.workspaceId, api.userId ?? null, parsed.data).catch((e) =>
    console.error("[generate-single] background job fallo crítico:", e)
  );

  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      message: "Generación iniciada en segundo plano."
    },
    { status: 202 }
  );
});

async function runJobAsync(
  jobId: string,
  workspaceId: string,
  userId: string | null,
  params: Params
) {
  const t0 = Date.now();
  const events: any[] = [];
  const pushEvent = async (level: "info" | "warn" | "error", message: string) => {
    events.push({ ts: Date.now() - t0, level, message });
    await prisma.backgroundJob
      .update({ where: { id: jobId }, data: { events: events as any } })
      .catch(() => {});
  };

  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressMsg: "Llamando a Claude…", progressPct: 10 }
    });
    await pushEvent("info", "Job iniciado, llamando a Claude…");

    const scheduledFor = new Date(params.scheduledFor);
    const month = scheduledFor.toISOString().slice(0, 7);
    const isVideo = VIDEO_FORMATS.has(params.format);

    const updateProgress = async (msg: string, pct: number) => {
      await prisma.backgroundJob
        .update({ where: { id: jobId }, data: { progressMsg: msg, progressPct: pct } })
        .catch(() => {});
      await pushEvent("info", msg);
    };

    const result = await generateMonth({
      workspaceId,
      userId,
      jobId,
      clientId: params.clientId,
      month,
      count: 1,
      networks: params.networks,
      copyLength: params.copyLength,
      perNetworkCopy: params.perNetworkCopy,
      extraGuidance: params.extraGuidance,
      status: params.status,
      // En vídeo NO generamos imagen estática: el pipeline de vídeo crea sus
      // propias tomas (gpt-image-2) y las anima. Generamos solo el copy aquí.
      generateImages: !isVideo,
      imageQuality: params.imageQuality,
      singleTopic: params.title,
      singleFormat: params.format,
      singleScheduledFor: scheduledFor,
      imageIncludeHint: params.imageIncludeHint,
      imageAvoidHint: params.imageAvoidHint,
      useRosterPersons: (params as any).useRosterPersons,
      onProgress: async (msg, pct) => {
        // En vídeo el copy es la primera mitad: dejamos espacio para el vídeo.
        await updateProgress(msg, isVideo ? Math.min(40, Math.round(pct * 0.4)) : pct);
      }
    });

    // Encadena el pipeline de vídeo sobre el post recién creado.
    let videoNote = "";
    if (isVideo && result.createdIds.length > 0) {
      const postId = result.createdIds[0];
      try {
        await updateProgress("Generando vídeo: storyboard, tomas y montaje…", 45);
        const out = await generatePostVideo({
          workspaceId,
          postId,
          extraGuidance: params.extraGuidance,
          shots: 2,
          voiceover: true,
          subtitles: true
        });
        videoNote = out.note;
        await updateProgress("Vídeo listo y adjuntado al post.", 100);
      } catch (e: any) {
        const h = humanizeAiError(e);
        await pushEvent("error", `Vídeo falló: ${h.message}`);
        videoNote = ` (Vídeo no generado: ${h.message})`;
      }
    }

    const summary = isVideo
      ? result.count > 0
        ? `✓ Publicación creada · ${videoNote.startsWith(" (Vídeo no") ? "vídeo falló" : "vídeo listo"}`
        : "Sin resultado"
      : result.count > 0
        ? `✓ Publicación creada · ${result.imagesGenerated > 0 ? "imagen lista" : result.imagesFailed > 0 ? "imagen falló" : "sin imagen"}`
        : "Sin resultado";
    await pushEvent("info", summary);
    if (result.imageErrors && result.imageErrors.length > 0) {
      for (const err of result.imageErrors) {
        await pushEvent("error", `Imagen falló: ${err}`);
      }
    }
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: summary,
        result: result as any,
        systemPrompt: result.systemPrompt ?? null,
        userPrompt: result.userPrompt ?? null
      }
    });
  } catch (e: any) {
    let code = "ai_error";
    let message = e?.message ?? "Error generando";
    if (e instanceof AIDisabledError) {
      code = "ai_disabled";
    } else if (e?.message === "Cliente no encontrado") {
      code = "client_not_found";
    } else {
      const h = humanizeAiError(e);
      code = h.code;
      message = h.message;
    }
    await pushEvent("error", message);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message,
        progressMsg: `Error: ${message.slice(0, 100)}`
      }
    });
  }
}
