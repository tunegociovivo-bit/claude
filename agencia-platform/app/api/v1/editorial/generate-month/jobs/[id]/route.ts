/**
 * GET — estado del job
 * DELETE — cancela el job (lo marca CANCELLED si seguía vivo, o lo borra
 *          si ya estaba terminado)
 *
 * También aplica auto-detección de jobs zombies: si un job sigue PENDING
 * después de 90s o RUNNING después de 10 min, lo marcamos FAILED al leer.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const ZOMBIE_PENDING_MS = 90 * 1000; // 90s en PENDING = zombie
const ZOMBIE_RUNNING_MS = 10 * 60 * 1000; // 10min en RUNNING = zombie

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  let job = await prisma.backgroundJob.findFirst({
    where: {
      id: params.id,
      workspaceId: api.workspaceId,
      kind: "editorial.generate_month"
    }
  });
  if (!job) throw new ApiError(404, "not_found", "Job no encontrado");

  // Auto-detección de zombie: si el proceso Node murió antes de empezar
  // o se quedó colgado, marcamos el job como FAILED para que el toast
  // pueda quitarse.
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
    status: job.status,
    progressPct: job.progressPct,
    progressMsg: job.progressMsg,
    result: job.result,
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
      kind: "editorial.generate_month"
    }
  });
  if (!job) throw new ApiError(404, "not_found", "Job no encontrado");

  if (job.status === "PENDING" || job.status === "RUNNING") {
    // No podemos parar el Promise en curso (Node no tiene cancel), pero
    // marcamos como CANCELLED para que el toast se quite y el user
    // pueda lanzar otro.
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        progressMsg: "Cancelado por el usuario"
      }
    });
  } else {
    // Ya terminado → borrar del histórico
    await prisma.backgroundJob.delete({ where: { id: job.id } });
  }
  return NextResponse.json({ ok: true });
});
