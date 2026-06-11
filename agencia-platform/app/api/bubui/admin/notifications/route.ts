/**
 * GET   /api/bubui/admin/notifications  → { config: { emails[], whatsapp } }
 * PATCH /api/bubui/admin/notifications  → body { emails: string[], whatsapp?: string|null }
 * POST  /api/bubui/admin/notifications  → envía una notificación de PRUEBA
 * (cabecera x-admin-token)
 *
 * Destinos de las notificaciones internas del equipo (solicitudes de cartel,
 * etc.): uno o varios emails + un número de WhatsApp. Editable sin deploy.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { getTeamNotifyConfig, setTeamNotifyConfig, notifyTeam } from "@/lib/bubui/team-notify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json({ config: await getTeamNotifyConfig() });
}

const schema = z.object({
  emails: z.array(z.string().email()).min(1).max(10),
  whatsapp: z.string().trim().max(20).nullable().optional()
});

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "Revisa los emails (mínimo 1 válido)." } },
      { status: 400 }
    );
  }
  const config = await setTeamNotifyConfig({
    emails: parsed.data.emails,
    whatsapp: parsed.data.whatsapp ?? null
  });
  return NextResponse.json({ config });
}

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const result = await notifyTeam({
    subject: "Prueba de notificaciones",
    text: "Esto es una prueba desde el panel admin de Bubui. Si la lees, este canal funciona. ✅"
  });
  return NextResponse.json({ ok: true, result });
}
