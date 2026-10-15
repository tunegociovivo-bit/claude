import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { deleteSource, listSources, setSourceEnabled } from "@/lib/radar/sources";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ enabled: z.boolean() });

// Activar/desactivar un portal sin borrar sus credenciales.
export async function PATCH(req: NextRequest, { params }: { params: { portal: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    try {
      await setSourceEnabled(user.workspaceId, params.portal, parsed.data.enabled);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    return Response.json({ sources: await listSources(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}

// Borrar las credenciales guardadas de un portal.
export async function DELETE(req: NextRequest, { params }: { params: { portal: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    await deleteSource(user.workspaceId, params.portal);
    return Response.json({ sources: await listSources(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}
