import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarUser, requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { listSources, saveSourceCredentials } from "@/lib/radar/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRadarUser();
    return Response.json({ sources: await listSources(user.workspaceId), isAdmin: user.isAdmin });
  } catch (error) {
    return radarError(error);
  }
}

const schema = z.object({
  portal: z.string().max(30),
  username: z.string().max(200),
  password: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

// Guarda las credenciales de un portal (solo administrador del negocio).
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    try {
      await saveSourceCredentials({
        workspaceId: user.workspaceId,
        portal: parsed.data.portal,
        username: parsed.data.username,
        password: parsed.data.password ?? null,
        enabled: parsed.data.enabled,
      });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    return Response.json({ sources: await listSources(user.workspaceId), isAdmin: true });
  } catch (error) {
    return radarError(error);
  }
}
