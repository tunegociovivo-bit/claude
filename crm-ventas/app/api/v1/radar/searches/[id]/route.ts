import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { listSearches, updateSearch, deleteSearch } from "@/lib/radar/searches";
import { evaluateSearchAgainstAll } from "@/lib/radar/match";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().max(80).optional(),
  criteria: z.record(z.any()).optional(),
  notifyWhatsapp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    try {
      await updateSearch({ workspaceId: user.workspaceId, id: params.id, ...parsed.data });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    if (parsed.data.criteria !== undefined) await evaluateSearchAgainstAll(user.workspaceId, params.id).catch(() => 0);
    return Response.json({ searches: await listSearches(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    await deleteSearch(user.workspaceId, params.id);
    return Response.json({ searches: await listSearches(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}
