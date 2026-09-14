import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { sendEmail } from "@/lib/integrations/email";
import { buildAdminEnrollmentEmail, emailVerificationCodePrefix, hashEnrollmentToken, normalizeEnrollmentCode } from "@/lib/time-tracking/enrollment";

export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "time-enrollment-verify", limit: 10 });
  if (limited) return limited;
  const parsed = z.object({ code: z.string().max(80), deviceId: z.string().min(8).max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: "Código de verificación no válido" } }, { status: 400 });
  const code = normalizeEnrollmentCode(parsed.data.code);
  const prefix = emailVerificationCodePrefix(code);
  if (!prefix) return NextResponse.json({ error: { message: "Código de verificación no válido" } }, { status: 400 });
  const request = await prisma.timeTrackerEnrollmentRequest.findUnique({ where: { verificationPrefix: prefix } });
  if (!request || !["EMAIL_PENDING", "PENDING"].includes(request.status) || request.expiresAt < new Date() || request.deviceId !== parsed.data.deviceId || !(await bcrypt.compare(code, request.verificationHash))) {
    return NextResponse.json({ error: { message: "Código de verificación no válido o caducado" } }, { status: 401 });
  }
  if (request.status === "PENDING") return NextResponse.json({ ok: true, pendingApproval: true });

  const promoted = await prisma.timeTrackerEnrollmentRequest.updateMany({
    where: { id: request.id, status: "EMAIL_PENDING" },
    data: { status: "PENDING", verifiedAt: new Date() },
  });
  if (promoted.count !== 1) return NextResponse.json({ ok: true, alreadyVerified: true });

  const adminEmail = (process.env.TIME_TRACKING_ADMIN_EMAIL || "info@negociovivo.com").trim().toLowerCase();
  try {
    // The raw approval token is not stored. Rotate it now so only this email can reveal it.
    const rawToken = randomBytes(32).toString("base64url");
    await prisma.timeTrackerEnrollmentRequest.update({ where: { id: request.id }, data: { approvalTokenHash: hashEnrollmentToken(rawToken) } });
    const hubUrl = (process.env.NEXTAUTH_URL || "https://hub.negociovivo.app").replace(/\/$/, "");
    const email = buildAdminEnrollmentEmail({ name: request.requesterName, email: request.requesterEmail, approvalUrl: `${hubUrl}/control-horario?enrollmentRequest=${encodeURIComponent(rawToken)}` });
    await sendEmail({ to: adminEmail, subject: email.subject, html: email.html, workspaceId: request.workspaceId, idempotencyKey: `time-enrollment-request-${request.id}` });
  } catch (error) {
    await prisma.timeTrackerEnrollmentRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "EMAIL_PENDING", verifiedAt: null } }).catch(() => {});
    throw error;
  }
  return NextResponse.json({ ok: true, pendingApproval: true });
}
