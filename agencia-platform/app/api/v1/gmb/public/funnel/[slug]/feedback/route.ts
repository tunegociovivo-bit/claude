/**
 * POST /api/v1/gmb/public/funnel/[slug]/feedback — queja/opinión privada (1-3 estrellas). Se guarda
 * en el Hub y se envía al correo del dueño (Reply-To = email del cliente). Público, rate-limited,
 * con honeypot anti-spam.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { sendEmail } from "@/lib/integrations/email";
import { EMAIL_RE, complaintEmailHtml } from "@/lib/gmb/review-funnel";

export const dynamic = "force-dynamic";

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const limited = rateLimitPublic(req, { tag: "gmb-funnel-feedback", limit: 8 });
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  if (clip(body?.website, 200)) return NextResponse.json({ ok: true }); // honeypot
  const stars = Number(body?.stars);
  const message = clip(body?.message, 4000);
  const name = clip(body?.name, 120);
  const email = clip(body?.email, 200);
  const phone = clip(body?.phone, 40);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return NextResponse.json({ ok: false, message: "Valoración no válida." }, { status: 400 });
  if (message.length < 5) return NextResponse.json({ ok: false, message: "Cuéntanos un poco más, por favor." }, { status: 400 });
  if (email && !EMAIL_RE.test(email)) return NextResponse.json({ ok: false, message: "El email no es válido." }, { status: 400 });

  const f = await prisma.gmbReviewFunnel.findUnique({ where: { slug } });
  if (!f?.active) return NextResponse.json({ ok: false, message: "Esta página ya no está disponible." }, { status: 404 });

  const fb = await prisma.gmbReviewFunnelFeedback.create({
    data: { workspaceId: f.workspaceId, funnelId: f.id, stars, name, email, phone, message }
  });
  await prisma.gmbReviewFunnelEvent.create({ data: { workspaceId: f.workspaceId, funnelId: f.id, type: "complaint", stars } }).catch(() => {});

  if (f.ownerEmail && EMAIL_RE.test(f.ownerEmail)) {
    try {
      await sendEmail({
        workspaceId: f.workspaceId,
        to: f.ownerEmail,
        subject: `Opinión privada (${stars}★) de un cliente · ${f.businessName}`,
        html: complaintEmailHtml(f, { stars, name, email, phone, message }),
        text: `${stars}/5 estrellas\n\n${message}\n\nNombre: ${name}\nEmail: ${email}\nTeléfono: ${phone}`,
        ...(email ? { replyTo: email } : {}),
        idempotencyKey: `gmb-funnel-fb-${fb.id}`
      });
      await prisma.gmbReviewFunnelFeedback.updateMany({ where: { id: fb.id, workspaceId: f.workspaceId }, data: { emailed: true } });
    } catch {
      /* queda guardada en el Hub aunque falle el correo */
    }
  }
  return NextResponse.json({ ok: true });
}
