import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { sendEmail } from "@/lib/integrations/email";
import { buildEmailVerificationEmail, createEmailVerificationCode, createEnrollmentRequestKey, hashEnrollmentToken, normalizeEnrollmentRequest } from "@/lib/time-tracking/enrollment";

export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "time-enrollment-request", limit: 5 });
  if (limited) return limited;
  let createdRequestId: string | null = null;
  try {
    const input = normalizeEnrollmentRequest(await req.json().catch(() => null));
    const adminEmail = (process.env.TIME_TRACKING_ADMIN_EMAIL || "info@negociovivo.com").trim().toLowerCase();
    const admin = await prisma.membership.findFirst({
      where: { role: "ADMIN", user: { email: adminEmail } },
      orderBy: { joinedAt: "asc" },
      select: { workspaceId: true },
    });
    if (!admin) return NextResponse.json({ error: { message: "No se ha configurado el administrador" } }, { status: 503 });
    const member = await prisma.membership.findFirst({
      where: { workspaceId: admin.workspaceId, user: { email: { equals: input.email, mode: "insensitive" } } },
      select: { user: { select: { email: true } } },
    });
    if (!member?.user.email) return NextResponse.json({ ok: true });

    const approvalToken = randomBytes(32).toString("base64url");
    const verification = createEmailVerificationCode();
    const enrollmentRequest = await prisma.timeTrackerEnrollmentRequest.create({ data: {
      workspaceId: admin.workspaceId,
      requesterName: input.name,
      requesterEmail: member.user.email.toLowerCase(),
      deviceId: input.deviceId,
      requestKey: createEnrollmentRequestKey(member.user.email),
      approvalTokenHash: hashEnrollmentToken(approvalToken),
      verificationPrefix: verification.prefix,
      verificationHash: await bcrypt.hash(verification.display, 10),
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    } });
    createdRequestId = enrollmentRequest.id;
    const email = buildEmailVerificationEmail({ name: input.name, code: verification.display });
    await sendEmail({ to: member.user.email, subject: email.subject, html: email.html, workspaceId: admin.workspaceId, idempotencyKey: `time-enrollment-verification-${enrollmentRequest.id}` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[time-enrollment] request failed", error);
    if (createdRequestId) await prisma.timeTrackerEnrollmentRequest.delete({ where: { id: createdRequestId } }).catch(() => {});
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ ok: true, alreadyPending: true });
    return NextResponse.json({ error: { message: "No se pudo enviar la solicitud. Inténtalo de nuevo." } }, { status: 400 });
  }
}
