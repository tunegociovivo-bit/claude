import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarUser, assertSameOrigin, radarError } from "@/lib/radar/api";
import { setMatchStatus } from "@/lib/radar/listings-query";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["new", "seen", "interesting", "discarded"]) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarUser();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Estado no válido" }, { status: 400 });
    try {
      await setMatchStatus(user.workspaceId, params.id, parsed.data.status);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return radarError(error);
  }
}
