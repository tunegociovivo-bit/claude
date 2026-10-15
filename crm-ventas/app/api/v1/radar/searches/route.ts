import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarUser, requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { listSearches, createSearch } from "@/lib/radar/searches";
import { evaluateSearchAgainstAll } from "@/lib/radar/match";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRadarUser();
    return Response.json({ searches: await listSearches(user.workspaceId), isAdmin: user.isAdmin });
  } catch (error) {
    return radarError(error);
  }
}

const schema = z.object({
  name: z.string().max(80),
  criteria: z.record(z.any()).default({}),
  notifyWhatsapp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    let id: string;
    try {
      id = await createSearch({ workspaceId: user.workspaceId, ...parsed.data });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    // Cruza con el stock ya visto: muestra de inmediato cuántos coinciden
    // (no avisa por estos; el aviso es solo para coches nuevos).
    const matched = await evaluateSearchAgainstAll(user.workspaceId, id).catch(() => 0);
    return Response.json({ id, matched, searches: await listSearches(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}
