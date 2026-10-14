import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { provisionWhatsappServer, WhatsappProvisionError } from "@/lib/admin/whatsapp-provision";

export const dynamic = "force-dynamic";

// Solo operadores: activa el servidor de WhatsApp (WAHA) de un cliente para
// que pueda conectar sus números por QR. Cuerpo: { fromWorkspaceId } o
// { url, apiKey }, más { replace: true } para cambiar uno existente.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let operator: { email: string };
  try { operator = await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const replace = body?.replace === true;
  const input =
    typeof body?.fromWorkspaceId === "string" && body.fromWorkspaceId
      ? { fromWorkspaceId: body.fromWorkspaceId, replace }
      : { url: String(body?.url ?? ""), apiKey: String(body?.apiKey ?? ""), replace };
  try {
    const whatsapp = await provisionWhatsappServer(params.id, input);
    console.info(`[admin] ${operator.email} activa el servidor de WhatsApp de ${params.id} (${whatsapp.host})`);
    return NextResponse.json({ ok: true, whatsapp });
  } catch (error) {
    if (error instanceof WhatsappProvisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[admin] activar WhatsApp", error);
    return NextResponse.json({ error: "No se pudo activar WhatsApp" }, { status: 500 });
  }
}
