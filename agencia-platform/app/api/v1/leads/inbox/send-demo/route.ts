/**
 * POST /api/v1/leads/inbox/send-demo   { phone }
 *
 * Envía al contacto de la conversación el enlace a su demo personalizada de
 * Bubui (/bubui/demo/<leadId>) por WhatsApp, por el mismo número/chatId al
 * que escribió. Requiere que la conversación esté vinculada a un lead.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { sendText } from "@/lib/leads/waha";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().min(5).max(40) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { phone } = parsed.data;

  // Último entrante para saber el lead y el chatId de respuesta.
  const lastIn = await prisma.leadInboxMessage.findFirst({
    where: { workspaceId: api.workspaceId, direction: "in", OR: [{ phoneNormalized: phone }, { fromPhone: phone }] },
    orderBy: { receivedAt: "desc" },
    include: { lead: { select: { id: true, name: true } } },
    // meta para el chatId original (LID)
  });
  const leadId = lastIn?.lead?.id ?? null;
  if (!leadId) {
    throw new ApiError(409, "no_lead", "Esta conversación no está vinculada a un lead, no hay demo que enviar.");
  }

  const base = publicBaseUrl(req, ((await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } }))?.settings as any)?.leads?.publicBaseUrl);
  const demoUrl = `${base.replace(/\/+$/, "")}/bubui/demo/${leadId}`;
  const name = lastIn?.lead?.name ?? "tu negocio";
  const text = `Mira cómo quedaría ${name} en Bubui (fidelización + reseñas para negocios locales):\n${demoUrl}`;

  const meta: any = (lastIn as any)?.meta ?? {};
  const chatId =
    (typeof meta?.payload?.from === "string" && meta.payload.from) ||
    (lastIn?.fromPhone && String(lastIn.fromPhone).includes("@") ? String(lastIn.fromPhone) : "") ||
    phone;

  let externalMessageId: string | null = null;
  try {
    const out = await sendText({ workspaceId: api.workspaceId, phoneNormalized: chatId, text, session: lastIn?.instanceName ?? undefined });
    externalMessageId = out.messageId ?? null;
  } catch (e: any) {
    throw new ApiError(502, "send_failed", `No se pudo enviar: ${e?.message ?? e}`);
  }

  const saved = await prisma.leadInboxMessage.create({
    data: {
      workspaceId: api.workspaceId,
      leadId,
      fromPhone: phone,
      phoneNormalized: phone,
      channel: "whatsapp",
      direction: "out",
      body: text,
      read: true,
      externalMessageId,
      instanceName: lastIn?.instanceName ?? null
    }
  });

  return NextResponse.json({ ok: true, id: saved.id, at: saved.receivedAt.toISOString(), demoUrl });
});
