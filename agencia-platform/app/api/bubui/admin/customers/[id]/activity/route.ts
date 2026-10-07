/**
 * GET /api/bubui/admin/customers/[id]/activity   (sesión ADMIN del Hub)
 *
 * Historial de un usuario de Bubui: escaneos, compras, cupones, retos, ofertas
 * compartidas, amigos, reseñas, mesas, citas y notificaciones, del más reciente
 * al más antiguo.
 *
 * Query:
 *   limit   nº de eventos por página (1-200, por defecto 50)
 *   before  ISO; devuelve eventos anteriores (paginación con `nextBefore`)
 *   kinds   filtro separado por comas (scan,purchase,coupon,share,…)
 *
 * La primera página (sin `before`) incluye también la ficha del usuario y sus
 * totales históricos.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";
import { ACTIVITY_KINDS, type ActivityKind, loadCustomerActivity, loadCustomerActivitySummary } from "@/lib/bubui/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { id } = await props.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: { code: "validation", message: "Usuario no válido" } }, { status: 400 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: { code: "validation", message: "Fecha 'before' no válida" } }, { status: 400 });
  }
  const kinds = (url.searchParams.get("kinds") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is ActivityKind => (ACTIVITY_KINDS as readonly string[]).includes(k));

  const page = await loadCustomerActivity(id, {
    before,
    limit: Number.isFinite(limit) ? limit : 50,
    kinds
  });
  if (!page) {
    return NextResponse.json({ error: { code: "not_found", message: "Usuario no encontrado" } }, { status: 404 });
  }

  if (before) return NextResponse.json(page);

  const [customer, summary] = await Promise.all([
    prisma.bubuiCustomer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        phoneVerified: true,
        postalCode: true,
        createdAt: true,
        lastSeenAt: true,
        appVersion: true,
        appBuild: true,
        appPlatform: true,
        plan: true,
        planExpiresAt: true,
        ambassadorLevel: true,
        referralCode: true,
        referralWalletPct: true,
        referredById: true,
        firstBusinessId: true
      }
    }),
    loadCustomerActivitySummary(id)
  ]);
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found", message: "Usuario no encontrado" } }, { status: 404 });
  }
  const [referredBy, firstBusiness] = await Promise.all([
    customer.referredById
      ? prisma.bubuiCustomer.findUnique({ where: { id: customer.referredById }, select: { id: true, name: true } })
      : null,
    customer.firstBusinessId
      ? prisma.bubuiBusiness.findUnique({ where: { id: customer.firstBusinessId }, select: { id: true, name: true } })
      : null
  ]);
  const plusActive = customer.plan === "plus" && (!customer.planExpiresAt || customer.planExpiresAt > new Date());

  return NextResponse.json({
    customer: { ...customer, plusActive, referredBy, firstBusiness },
    summary,
    ...page
  });
}
