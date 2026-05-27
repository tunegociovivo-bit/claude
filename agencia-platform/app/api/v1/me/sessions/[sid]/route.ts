/**
 * DELETE /api/v1/me/sessions/[sid] → revoca una sesión concreta del user.
 * Si revocas tu propia sesión actual, la próxima request fallará con
 * "session_revoked" y la UI te llevará a /login.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { revokeSession } from "@/lib/security/sessions";
import { auditFromReq } from "@/lib/audit/log";

export const DELETE = withApi({ rate: "destructive" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const ok = await revokeSession(api.userId, params.sid as string, "user_revoked");
  if (!ok) throw new ApiError(404, "not_found", "Sesión no encontrada o ya revocada");
  auditFromReq(req, api, {
    action: "user.session_revoked",
    targetType: "USER",
    targetId: api.userId,
    meta: { revokedSid: params.sid }
  });
  return NextResponse.json({ ok: true });
});
