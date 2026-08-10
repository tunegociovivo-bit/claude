import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resendDeliveryStatus, verifyResendWebhook } from "@/lib/invoicing/resend-webhook";

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  const payload = await req.text();
  const webhookId = req.headers.get("svix-id");
  const valid = verifyResendWebhook({
    payload,
    id: webhookId,
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    secret
  });
  if (!valid || !webhookId) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  let event: any;
  try { event = JSON.parse(payload); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const status = resendDeliveryStatus(event?.type);
  const providerId = event?.data?.email_id;
  if (!status || typeof providerId !== "string") return NextResponse.json({ ok: true, ignored: true });
  const taggedDeliveryId = event?.data?.tags?.delivery_id;
  const delivery = typeof taggedDeliveryId === "string"
    ? await prisma.invoiceDelivery.findUnique({ where: { id: taggedDeliveryId } })
    : await prisma.invoiceDelivery.findUnique({ where: { providerId } });
  if (!delivery) return NextResponse.json({ ok: true, ignored: true });
  const eventAt = new Date(event.created_at);
  if (Number.isNaN(eventAt.getTime())) return NextResponse.json({ error: "invalid_event_date" }, { status: 400 });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${delivery.id}))`;
      await tx.invoiceDeliveryEvent.create({
        data: { deliveryId: delivery.id, webhookId, type: event.type, eventAt, payload: event as Prisma.InputJsonValue }
      });
      const fresh = await tx.invoiceDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      if (!fresh.providerEventAt || eventAt >= fresh.providerEventAt) {
        const error = event?.data?.bounce?.message ?? event?.data?.error?.message ?? null;
        await tx.invoiceDelivery.update({
          where: { id: delivery.id },
          data: {
            status,
            providerId: fresh.providerId ?? providerId,
            providerEventAt: eventAt,
            deliveredAt: status === "DELIVERED" ? eventAt : fresh.deliveredAt,
            error: error ? String(error).slice(0, 2000) : fresh.error
          }
        });
      }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  return NextResponse.json({ ok: true });
}
