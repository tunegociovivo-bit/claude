import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { createEnrollmentApiCredential, enrollmentCodePrefix, normalizeEnrollmentCode } from "@/lib/time-tracking/enrollment";

export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "time-enrollment-redeem", limit: 10 });
  if (limited) return limited;
  const parsed = z.object({ code: z.string().max(80), deviceId: z.string().min(8).max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: "Código no válido" } }, { status: 400 });
  const code = normalizeEnrollmentCode(parsed.data.code);
  const codePrefix = enrollmentCodePrefix(code);
  if (!codePrefix) return NextResponse.json({ error: { message: "Código no válido" } }, { status: 400 });
  const request = await prisma.timeTrackerEnrollmentRequest.findUnique({ where: { codePrefix } });
  if (!request?.codeHash || !request.selectedUserId || !["APPROVED", "CONSUMED"].includes(request.status) || !request.codeExpiresAt || request.codeExpiresAt < new Date() || request.deviceId !== parsed.data.deviceId) {
    return NextResponse.json({ error: { message: "Código no válido o caducado" } }, { status: 401 });
  }
  if (!(await bcrypt.compare(code, request.codeHash))) return NextResponse.json({ error: { message: "Código no válido o caducado" } }, { status: 401 });

  const serverSecret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!serverSecret) return NextResponse.json({ error: { message: "Servicio de vinculación no configurado" } }, { status: 503 });
  const credential = createEnrollmentApiCredential({ requestId: request.id, code, deviceId: parsed.data.deviceId, serverSecret });
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.timeTrackerEnrollmentRequest.updateMany({ where: { id: request.id, status: "APPROVED", consumedAt: null }, data: { status: "CONSUMED", consumedAt: new Date() } });
      if (claimed.count === 1) {
        await tx.apiKey.create({ data: { workspaceId: request.workspaceId, userId: request.selectedUserId!, name: `control-horario:${request.requesterEmail}:${request.deviceId}`, prefix: credential.prefix, hashed: await bcrypt.hash(credential.secret, 10), scopes: ["time_tracking:write"] } });
        return;
      }
      const existing = await tx.apiKey.findUnique({ where: { prefix: credential.prefix }, select: { id: true, revokedAt: true } });
      if (!existing || existing.revokedAt) throw new Error("credential_unavailable");
    });
  } catch {
    return NextResponse.json({ error: { message: "No se pudo recuperar la vinculación" } }, { status: 409 });
  }
  return NextResponse.json({ ok: true, token: `${credential.prefix}.${credential.secret}` });
}
