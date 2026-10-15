import { NextRequest } from "next/server";
import { requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { getSourceId } from "@/lib/radar/sources";
import { enqueueRun } from "@/lib/radar/run";

export const dynamic = "force-dynamic";

// Prueba el acceso a UN portal (lo revisa ahora). Útil tras poner credenciales.
export async function POST(req: NextRequest, { params }: { params: { portal: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const sourceId = await getSourceId(user.workspaceId, params.portal);
    if (!sourceId) return Response.json({ error: "Primero guarda el usuario y la contraseña de este portal." }, { status: 400 });
    const { runId, reason } = await enqueueRun(user.workspaceId, "test", sourceId);
    if (!runId) return Response.json({ error: reason ?? "No se pudo lanzar la prueba." }, { status: 409 });
    return Response.json({ ok: true, runId });
  } catch (error) {
    return radarError(error);
  }
}
