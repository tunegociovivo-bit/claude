import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRadarUser, requireRadarAdmin, assertSameOrigin, radarError } from "@/lib/radar/api";
import { getRadarConfig, saveRadarConfig, MAX_TIMES, MAX_NOTIFY_EMAILS, MAX_NOTIFY_PHONES } from "@/lib/radar/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRadarUser();
    return Response.json(await getRadarConfig(user.workspaceId));
  } catch (error) {
    return radarError(error);
  }
}

const schema = z.object({
  times: z.array(z.string().max(5)).max(MAX_TIMES).optional(),
  days: z.array(z.number().int()).max(7).optional(),
  notifyPhones: z.array(z.string().max(40)).max(MAX_NOTIFY_PHONES).optional(),
  notifyEmails: z.array(z.string().max(254)).max(MAX_NOTIFY_EMAILS).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireRadarAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    try {
      const saved = await saveRadarConfig(user.workspaceId, parsed.data);
      return Response.json(saved);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  } catch (error) {
    return radarError(error);
  }
}
