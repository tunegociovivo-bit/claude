import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { listBackupCodes } from "@/lib/security/totp";
import { prisma } from "@/lib/db/prisma";

export const GET = withApi({}, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const user = await prisma.user.findUnique({
    where: { id: api.userId },
    select: { totpEnabledAt: true }
  });
  const codes = user?.totpEnabledAt
    ? await listBackupCodes(api.userId)
    : { total: 0, used: 0, remaining: 0 };
  return NextResponse.json({
    enabled: !!user?.totpEnabledAt,
    enabledAt: user?.totpEnabledAt,
    backupCodes: codes
  });
});
