import { requireRadarUser, radarError } from "@/lib/radar/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Últimas revisiones (para mostrar el estado «revisando…» y el resultado).
export async function GET() {
  try {
    const user = await requireRadarUser();
    const runs = await prisma.radarRun.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, trigger: true, status: true, found: true, newCount: true, matched: true,
        summary: true, error: true, createdAt: true, startedAt: true, finishedAt: true,
      },
    });
    const active = runs.some((r) => r.status === "queued" || r.status === "running");
    return Response.json({
      active,
      runs: runs.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return radarError(error);
  }
}
