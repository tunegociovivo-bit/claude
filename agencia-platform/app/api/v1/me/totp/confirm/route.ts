import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { confirmEnrollment } from "@/lib/security/totp";
import { auditFromReq } from "@/lib/audit/log";

const bodySchema = z.object({ code: z.string().min(6).max(8) });

export const POST = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const r = await confirmEnrollment(api.userId, parsed.data.code);
  if (!r.ok) {
    if (r.reason === "no_pending") {
      throw new ApiError(400, "no_pending", "No hay enrolamiento pendiente. Reinicia el proceso.");
    }
    throw new ApiError(400, "bad_code", "Código incorrecto");
  }

  auditFromReq(req, api, {
    action: "user.totp_enabled",
    targetType: "USER",
    targetId: api.userId
  });

  return NextResponse.json({ ok: true, backupCodes: r.backupCodes });
});
