/**
 * GET — estado del job (incluye events expandible y prompts)
 * DELETE — solicita cancelación cooperativa (el loop chequea entre
 *          iteraciones y para limpiamente conservando lo creado). Si el
 *          job ya terminó, lo borra del histórico.
 *
 * También aplica auto-detección de jobs zombies: si un job sigue PENDING
 * después de 90s o RUNNING después de 10 min, lo marcamos FAILED al leer.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const ZOMBIE_PENDING_MS = 90 * 1000; // 90s en PENDING = zombie
const ZOMBIE_RUNNING_MS = 15 * 60 * 1000; // 15min en RUNNING = zombie

// Aceptamos el mismo endpoint para ambos kinds — el front no distingue.
const KINDS = ["editorial.generate_month", "editorial.generate_single"];

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  let job = await prisma.backgroundJob.findFirst({
    where: {
      id: params.id,
      workspaceId: api.workspaceId,
      kind: { in: KINDS }
    }
  });
  if (!job) throw new ApiError(404, "not_found", "Job no encontrado");

  const ageMs = Date.now() - new Date(job.createdAt).getTime();
  const runningAgeMs = job.startedAt
    ? Date.now() - new Date(job.startedAt).getTime()
    : 0;
  const isZombie =
    (job.status === "PENDING" && ageMs > ZOMBIE_PENDING_MS) ||
    (job.status === "RUNNING" && runningAgeMs > ZOMBIE_RUNNING_MS);
  if (isZombie) {
    job = await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "zombie",
        errorMessage:
          job.status === "PENDING"
            ? "El proceso de generación no llegó a arrancar (probablemente Railway reinició Node entre la creación del job y su ejecución). Vuelve a intentarlo."
            : "El proceso lleva demasiado tiempo sin reportar progreso. Probablemente Anthropic se ha colgado. Vuelve a intentarlo.",
        progressMsg: "Error: proceso zombie"
      }
    });
  }

  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    progressPct: job.progressPct,
    progressMsg: job.progressMsg,
    result: job.result,
    events: job.events,
    systemPrompt: job.systemPrompt,
    userPrompt: job.userPrompt,
    cancelRequested: (job as any).cancelRequested ?? false,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const job = await prisma.backgroundJob.findFirst({
    where: {
      id: params.id,
      workspaceId: api.workspaceId,
      kind: { in: KINDS }
    }
  });
  if (!job) throw new ApiError(404, "not_found", "Job no encontrado");

  if (job.status === "PENDING" || job.status === "RUNNING") {
    // Cancelación cooperativa: marcamos la bandera y el loop del job
    // saldrá entre iteraciones, conservando las publicaciones ya
    // commiteadas. Si está en la primera fase (Claude completion) no
    // podemos abortar la llamada HTTP, pero saldrá tras recibir la
    // respuesta antes de generar imágenes.
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        cancelRequested: true,
        progressMsg: (job.progressMsg ?? "") + " · cancelando…"
      }
    });
  } else {
    // Ya terminado → borrar del histórico
    await prisma.backgroundJob.delete({ where: { id: job.id } });
  }
  return NextResponse.json({ ok: true });
});
