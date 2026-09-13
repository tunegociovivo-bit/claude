import { NextRequest, NextResponse } from "next/server";
import { blockLeadCompletely } from "@/lib/leads/optout";
import { verifyUnsubscribeToken } from "@/lib/leads/unsubscribe-token";

export const dynamic = "force-dynamic";

function page(title: string, message: string, token?: string) {
  const action = token ? `<form method="post"><button type="submit">Confirmar baja</button></form>` : "";
  return new NextResponse(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;max-width:620px;margin:64px auto;padding:24px;color:#172033}button{background:#172033;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:650;cursor:pointer}</style><h1>${title}</h1><p>${message}</p>${action}</html>`, {
    status: token ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const payload = verifyUnsubscribeToken(params.token);
  if (!payload) return page("Enlace no válido", "Este enlace de baja no es válido o ha caducado.");
  return page("Dejar de recibir comunicaciones", "Confirma la baja y bloquearemos inmediatamente este contacto en email y WhatsApp.", params.token);
}

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const payload = verifyUnsubscribeToken(params.token);
  if (!payload) return page("Enlace no válido", "Este enlace de baja no es válido o ha caducado.");
  await blockLeadCompletely({
    workspaceId: payload.workspaceId,
    leadId: payload.leadId,
    email: payload.email,
    reason: "Baja solicitada desde email",
    source: "email_unsubscribe"
  });
  return new NextResponse("<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Baja confirmada</title><style>body{font:16px system-ui;max-width:620px;margin:64px auto;padding:24px;color:#172033}</style><h1>Baja confirmada</h1><p>No volveremos a contactar con esta dirección ni con los teléfonos asociados al negocio.</p></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}
