/**
 * GET    /api/v1/me/sessions          → lista sesiones activas del user
 * DELETE /api/v1/me/sessions?others=1 → revoca TODAS menos la actual
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listSessions, revokeAllOtherSessions } from "@/lib/security/sessions";
import { auditFromReq } from "@/lib/audit/log";

export const GET = withApi({}, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const sessions = await listSessions(api.userId, api.sid ?? null);
  return NextResponse.json({ sessions });
});

export const DELETE = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const url = new URL(req.url);
  if (url.searchParams.get("others") !== "1") {
    throw new ApiError(400, "missing_others", "Para revocar todo añade ?others=1");
  }
  if (!api.sid) {
    throw new ApiError(400, "no_current_session", "Esta sesión no tiene sid trackeado");
  }
  const revoked = await revokeAllOtherSessions(api.userId, api.sid);
  auditFromReq(req, api, {
    action: "user.sessions_revoked_all_others",
    targetType: "USER",
    targetId: api.userId,
    meta: { revoked }
  });
  return NextResponse.json({ ok: true, revoked });
});
