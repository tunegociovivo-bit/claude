/**
 * POST /api/v1/me/totp/disable
 * Body: { code: string }  // requiere un código TOTP/backup vivo para
 *                            evitar que un atacante con sesión robada lo desactive.
 *
 * Desactiva 2FA. Borra secret + backup codes.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { disableTotp, verifyCode } from "@/lib/security/totp";
import { auditFromReq } from "@/lib/audit/log";

const bodySchema = z.object({ code: z.string().min(6).max(10) });

export const POST = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const v = await verifyCode(api.userId, parsed.data.code);
  if (!v.ok) {
    if (v.reason === "no_totp") {
      throw new ApiError(400, "not_enabled", "2FA no está activado");
    }
    throw new ApiError(400, "bad_code", "Código incorrecto");
  }

  await disableTotp(api.userId);

  auditFromReq(req, api, {
    action: "user.totp_disabled",
    targetType: "USER",
    targetId: api.userId,
    meta: { usedBackupCode: v.usedBackupCode }
  });

  return NextResponse.json({ ok: true });
});
