/**
 * POST /api/bubui/business/[id]/notifications/read
 * Marca como leídas todas las notificaciones del negocio.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  await prisma.bubuiBusinessNotification.updateMany({
    where: { businessId: params.id, read: false },
    data: { read: true }
  });
  return NextResponse.json({ ok: true });
}
