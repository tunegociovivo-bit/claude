/**
 * GET /api/bubui/admin/push/stats
 *
 * Conteo de suscritos a push por canal — para que el admin sepa, antes
 * de pulsar "Enviar", cuántos destinatarios reales tiene.
 *
 * Auth: sesión NextAuth con rol ADMIN.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { isBubuiPushEnabled } from "@/lib/bubui/push";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const [webSubs, mobileTokens] = await Promise.all([
    prisma.bubuiPushSubscription.findMany({ select: { customerId: true } }),
    prisma.bubuiMobilePushToken.findMany({ select: { customerId: true, platform: true } })
  ]);

  const webCustomers = new Set(webSubs.map((s) => s.customerId));
  const mobileCustomers = new Set(mobileTokens.map((t) => t.customerId));
  const allCustomers = new Set<string>([...webCustomers, ...mobileCustomers]);

  return NextResponse.json({
    web: {
      enabled: isBubuiPushEnabled(),
      devices: webSubs.length,
      customers: webCustomers.size
    },
    mobile: {
      enabled: true,
      devices: mobileTokens.length,
      customers: mobileCustomers.size,
      android: mobileTokens.filter((t) => t.platform === "android").length,
      ios: mobileTokens.filter((t) => t.platform === "ios").length
    },
    totalUniqueCustomers: allCustomers.size
  });
}
