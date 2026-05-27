/**
 * POST /api/v1/editorial/generate-month
 *
 * Encola un job en segundo plano y devuelve inmediatamente { jobId }.
 * El cliente hace polling a /api/v1/editorial/generate-month/jobs/{id}
 * para ver el progreso y el resultado.
 *
 * Esto evita el 502 del proxy de Railway cuando la generación tarda > 30s.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateMonth } from "@/lib/editorial/generate-month";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

const schema = z.object({
  clientId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().min(1).max(40).default(14),
  networks: z.array(z.string()).min(1).default(["instagram"]),
  mix: z
    .object({
      imagen: z.number().min(0).max(100).optional(),
      reel: z.number().min(0).max(100).optional(),
      carrusel: z.number().min(0).max(100).optional(),
      story: z.number().min(0).max(100).optional(),
      video: z.number().min(0).max(100).optional()
    })
    .optional(),
  copyLength: z.number().int().min(0).max(100).default(50),
  perNetworkCopy: z.boolean().default(false),
  extraGuidance: z.string().optional(),
  imageIncludeHint: z.string().optional(),
  imageAvoidHint: z.string().optional(),
  pillars: z.record(z.string(), z.number().min(0).max(100)).optional(),
  allowedDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  preferredHours: z.array(z.number().int().min(0).max(23)).optional(),
  useRosterPersons: z.array(z.string()).optional(),
  status: z.enum(["DRAFT", "REVIEW"]).default("DRAFT"),
  generateImages: z.boolean().default(true),
  imageQuality: z.enum(["low", "medium", "high"]).default("medium")
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Crear el job
  const job = await prisma.backgroundJob.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId ?? null,
      kind: "editorial.generate_month",
      status: "PENDING",
      progressPct: 0,
      progressMsg: "En cola…",
      request: parsed.data as any
    }
  });

  // Ejecutar en background (fire & forget). Railway Node es long-lived
  // así que el promise sigue corriendo aunque hayamos enviado la respuesta.
  runJobAsync(job.id, api.workspaceId, api.userId ?? null, parsed.data).catch((e) =>
    console.error("[generate-month] background job fallo crítico:", e)
  );

  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      message: "Generación iniciada en segundo plano. Haz polling en /jobs/{id}."
    },
    { status: 202 }
  );
});

async function runJobAsync(
  jobId: string,
  workspaceId: string,
  userId: string | null,
  params: z.infer<typeof schema>
) {
  // Helper para añadir un evento al array events[] del job (log
  // expandible en el toast). Cada evento: { ts, level, message }.
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

    const result = await generateMonth({
      workspaceId,
      userId,
      jobId,
      ...params,
      onProgress: async (msg, pct) => {
        await prisma.backgroundJob
          .update({
            where: { id: jobId },
            data: { progressMsg: msg, progressPct: pct }
          })
          .catch(() => {});
        await pushEvent("info", msg);
      }
    });

    const summary =
      params.generateImages && result.count > 0
        ? `✓ ${result.count} publicaciones · ${result.imagesGenerated} imágenes ${result.imagesFailed > 0 ? `· ${result.imagesFailed} fallidas` : ""}`
        : `✓ ${result.count} publicaciones creadas`;
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
