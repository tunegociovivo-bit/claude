/**
 * Config de cobro SEPA por cliente — listado. Solo ADMIN.
 * Nunca expone credenciales bancarias (solo IBAN enmascarado + referencias).
 *  GET ?q=
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const clients = await prisma.client.findMany({
    where: {
      workspaceId: api.workspaceId,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {})
    },
    orderBy: [{ sepaEnabled: "desc" }, { name: "asc" }],
    take: 300,
    select: {
      id: true, name: true,
      sepaEnabled: true, sepaMandateRef: true, sepaMandateActive: true,
      sepaSantanderTemplate: true, sepaIbanMasked: true
    }
  });
  return NextResponse.json({ items: clients });
});
