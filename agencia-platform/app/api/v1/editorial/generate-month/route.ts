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
  status: z.enum(["DRAFT", "REVIEW"]).default("DRAFT"),
  generateImages: z.boolean().default(false),
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
  try {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), progressMsg: "Llamando a Claude…", progressPct: 10 }
    });
    const result = await generateMonth({
      workspaceId,
      userId,
      ...params,
      onProgress: async (msg, pct) => {
        await prisma.backgroundJob
          .update({
            where: { id: jobId },
            data: { progressMsg: msg, progressPct: pct }
          })
          .catch(() => {});
      }
    });
    const summary =
      params.generateImages && result.count > 0
        ? `✓ ${result.count} publicaciones · ${result.imagesGenerated} imágenes ${result.imagesFailed > 0 ? `· ${result.imagesFailed} imágenes fallidas` : ""}`
        : `✓ ${result.count} publicaciones creadas`;
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progressPct: 100,
        progressMsg: summary,
        result: result as any
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
