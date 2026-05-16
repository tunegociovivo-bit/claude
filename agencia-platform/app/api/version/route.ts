/**
 * GET /api/version
 *
 * Devuelve qué versión del código está sirviéndose. Útil cuando un
 * cambio recién pusheado no se ve en la UI: el output dice si tu
 * deploy es realmente el último commit o todavía la build anterior.
 *
 * El commit hash se inyecta en build time vía la env VERCEL_GIT_COMMIT_SHA
 * (Vercel) o RAILWAY_GIT_COMMIT_SHA (Railway). Si no hay ninguna,
 * devolvemos "unknown" — lo que ya nos dice que no estamos en deploy
 * sino en local.
 *
 * También expone qué features están "vivas" en este código para
 * confirmar al instante si una mejora reciente ha aterrizado.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "unknown";

  return NextResponse.json({
    commit,
    commitShort: commit.slice(0, 7),
    deployedAt: process.env.VERCEL_GIT_COMMIT_DATE ?? null,
    branch:
      process.env.VERCEL_GIT_COMMIT_REF ??
      process.env.RAILWAY_GIT_BRANCH ??
      null,
    // Features que llegaron en commits recientes — sirven como
    // "canary" para verificar visualmente que el deploy está al día.
    features: {
      meetingRecorderInFooter: true, // commit 716b363
      meetingRecorderInNewTask: true, // commit 14d2530
      commentUploadProgress: true, // commit 731a650
      asanaFullMigration: true, // commit 548cc69
      kanbanColumnEditInline: true, // commit c611c5f
      commentBodyJson: true, // commit b5268f7
      commentFkFix: true // commit b5268f7
    }
  });
}
