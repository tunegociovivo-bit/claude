import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startEnrollment } from "@/lib/security/totp";

export const POST = withApi({ rate: "destructive" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  try {
    const r = await startEnrollment(api.userId);
    return NextResponse.json(r);
  } catch (e: any) {
    if (e?.message === "totp_already_enabled") {
      throw new ApiError(409, "already_enabled", "2FA ya está activado para esta cuenta");
    }
    throw e;
  }
});
