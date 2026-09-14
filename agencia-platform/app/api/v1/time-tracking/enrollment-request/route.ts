import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { sendEmail } from "@/lib/integrations/email";
import { buildWorkerCodeEmail, createEnrollmentCode, hashEnrollmentToken } from "@/lib/time-tracking/enrollment";

const tokenSchema = z.string().min(32).max(200);

export const GET = withApi({ scope: "admin", admin: true }, async (req, { api }) => {
  const token = tokenSchema.safeParse(req.nextUrl.searchParams.get("token"));
  if (!token.success) throw new ApiError(400, "invalid_request", "Solicitud no válida");
  const request = await prisma.timeTrackerEnrollmentRequest.findUnique({ where: { approvalTokenHash: hashEnrollmentToken(token.data) } });
  if (!request || request.workspaceId !== api.workspaceId || request.expiresAt < new Date()) throw new ApiError(404, "request_not_found", "La solicitud no existe o ha caducado");
  return NextResponse.json({ id: request.id, name: request.requesterName, email: request.requesterEmail, status: request.status, suggestedUserId: null });
});

export const POST = withApi({ scope: "admin", admin: true }, async (req, { api }) => {
  const parsed = z.object({ token: tokenSchema, userId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Selecciona el trabajador correspondiente");
  const request = await prisma.timeTrackerEnrollmentRequest.findUnique({ where: { approvalTokenHash: hashEnrollmentToken(parsed.data.token) } });
  if (!request || request.workspaceId !== api.workspaceId || request.expiresAt < new Date() || request.status !== "PENDING") throw new ApiError(409, "request_unavailable", "La solicitud ya fue atendida o ha caducado");
  const member = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: parsed.data.userId }, include: { user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(404, "member_not_found", "El trabajador no pertenece a esta empresa");
  if (member.user.email.toLowerCase() !== request.requesterEmail.toLowerCase()) throw new ApiError(409, "email_mismatch", "El email solicitado no coincide con el trabajador seleccionado");
  const policy = await prisma.timeTrackerPolicy.findUnique({ where: { userId: member.userId }, select: { trackingEnabled: true } });
  if (policy?.trackingEnabled === false) throw new ApiError(409, "tracking_excluded", "Este trabajador está excluido del control horario");

  const code = createEnrollmentCode();
  const approved = await prisma.timeTrackerEnrollmentRequest.updateMany({ where: { id: request.id, status: "PENDING" }, data: { status: "APPROVED", selectedUserId: member.userId, codePrefix: code.prefix, codeHash: await bcrypt.hash(code.display, 10), codeExpiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
  if (approved.count !== 1) throw new ApiError(409, "request_unavailable", "La solicitud ya fue atendida");
  const email = buildWorkerCodeEmail({ name: request.requesterName, code: code.display });
  try {
    await sendEmail({ to: member.user.email, subject: email.subject, html: email.html, workspaceId: api.workspaceId, idempotencyKey: `time-enrollment-code-${request.id}` });
  } catch (error) {
    await prisma.timeTrackerEnrollmentRequest.updateMany({ where: { id: request.id, status: "APPROVED", codePrefix: code.prefix }, data: { status: "PENDING", selectedUserId: null, codePrefix: null, codeHash: null, codeExpiresAt: null } }).catch(() => {});
    throw error;
  }
  return NextResponse.json({ ok: true, recipient: member.user.email });
});
