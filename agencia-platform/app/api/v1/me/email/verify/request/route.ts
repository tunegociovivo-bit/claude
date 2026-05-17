/**
 * POST /api/v1/me/email/verify/request
 *
 * Pide reenvío del email de verificación al usuario autenticado.
 * Rate-limit "destructive" para impedir spam.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requestEmailVerification } from "@/lib/security/email-verification";

export const POST = withApi({ rate: "destructive" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const r = await requestEmailVerification(api.userId);
  return NextResponse.json({ ok: true, sent: r.sent, debugUrl: r.debugUrl });
});
