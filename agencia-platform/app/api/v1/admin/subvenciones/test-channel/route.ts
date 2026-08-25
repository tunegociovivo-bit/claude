import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { normalizePhone, sendText } from "@/lib/leads/waha";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = z.object({ channel: z.enum(["closing_webhook", "opportunity_webhook", "whatsapp"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Canal no válido");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const sv: any = (ws?.settings as any)?.subvenciones ?? {};
  const message = "✅ Prueba del Cazador de Subvenciones de Negocio Vivo. El canal está operativo.";
  if (parsed.data.channel === "whatsapp") {
    const phone = normalizePhone(String(sv.whatsappTo ?? ""));
    if (!phone) throw new ApiError(400, "not_configured", "Configura primero el número de WhatsApp");
    await sendText({ workspaceId: api.workspaceId, phoneNormalized: phone, text: message, session: String(sv.whatsappSession ?? "") || undefined });
  } else {
    const key = parsed.data.channel === "closing_webhook" ? "webhookUrl" : "oportWebhookUrl";
    const url = String(sv[key] ?? "").trim();
    if (!url) throw new ApiError(400, "not_configured", "Configura primero este webhook");
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "subvenciones_prueba", message, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new ApiError(502, "channel_failed", `El canal respondió ${response.status}`);
  }
  return NextResponse.json({ ok: true });
});
