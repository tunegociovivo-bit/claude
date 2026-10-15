import { NextRequest } from "next/server";
import { requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { enqueueRun } from "@/lib/radar/run";

export const dynamic = "force-dynamic";

// Lanza una revisión manual de todos los portales activos del negocio.
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const { runId, reason } = await enqueueRun(user.workspaceId, "manual");
    if (!runId) return Response.json({ error: reason ?? "No se pudo lanzar la revisión." }, { status: 409 });
    return Response.json({ ok: true, runId });
  } catch (error) {
    return radarError(error);
  }
}
