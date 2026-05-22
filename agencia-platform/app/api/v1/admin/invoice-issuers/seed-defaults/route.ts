/**
 * POST /api/v1/admin/invoice-issuers/seed-defaults
 *
 * Crea las 4 empresas emisoras iniciales si no existen ya (match por
 * nombre, case-insensitive). Idempotente: las que ya estén se saltan.
 * Los datos fiscales (NIF, dirección, IBAN…) se completan luego desde
 * el editor de Emisores.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";

type Seed = {
  name: string;
  countryCode: string;
  residenceType: string;
  isDefault?: boolean;
};

const DEFAULTS: Seed[] = [
  { name: "Negocio Vivo S.C.A.", countryCode: "ESP", residenceType: "R", isDefault: true },
  { name: "Pronsia S.L.", countryCode: "ESP", residenceType: "R" },
  { name: "LemonRoi L.L.C.", countryCode: "USA", residenceType: "E" },
  { name: "Rixus Solutions L.L.C.", countryCode: "USA", residenceType: "E" }
];

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const existing = await prisma.invoiceIssuer.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true }
  });
  const existingNames = new Set(existing.map((e) => e.name.toLowerCase().trim()));
  const hasDefault = existing.length > 0;

  const created: string[] = [];
  for (const s of DEFAULTS) {
    if (existingNames.has(s.name.toLowerCase().trim())) continue;
    await prisma.invoiceIssuer.create({
      data: {
        workspaceId: api.workspaceId,
        name: s.name,
        taxId: "",
        countryCode: s.countryCode,
        personType: "J",
        residenceType: s.residenceType,
        isDefault: !!s.isDefault && !hasDefault
      }
    });
    created.push(s.name);
  }
  return NextResponse.json({ created: created.length, createdItems: created });
});
