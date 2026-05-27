/**
 * GET y PATCH de la ficha editorial del cliente (brief, branding, colores,
 * fuentes, refs visuales, dimensiones por formato, Drive). Migrado de
 * NV Dashboard (class-cliente-meta.php).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientEditorialMetaSchema } from "@/lib/api/schemas";

const META_SELECT = {
  id: true,
  name: true,
  brandBrief: true,
  website: true,
  brandColorPrimary: true,
  brandColorAccent: true,
  brandColorText: true,
  logoUrl: true,
  logoPosition: true,
  visualPattern: true,
  refsFidelity: true,
  competitors: true,
  dimensionsByFormat: true,
  referenceImages: true,
  patternTemplates: true,
  fonts: true,
  styleGuideCached: true,
  styleGuideHash: true,
  driveMode: true,
  driveRootId: true,
  driveSubfolders: true,
  imageModel: true,
  editorialDefaults: true,
  metaAdAccountId: true,
  metaPageId: true,
  metaInstagramId: true,
  metaLeadEmails: true
} as const;

export const GET = withApi({ scope: "clients:read" }, async (_req, { params, api }) => {
  const client = await prisma.client.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: META_SELECT
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  return NextResponse.json(client);
});

export const PATCH = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientEditorialMetaSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Normalizar: "" → null para los campos string opcionales
  const data: any = { ...parsed.data };
  for (const k of [
    "website",
    "logoUrl",
    "styleGuideCached",
    "driveRootId",
    "metaAdAccountId",
    "metaPageId",
    "metaInstagramId",
    "metaLeadEmails"
  ] as const) {
    if (data[k] === "") data[k] = null;
  }
  // Normalizar la cuenta publicitaria: quitar prefijo "act_" y espacios
  // para guardar solo el id numérico de forma consistente.
  if (typeof data.metaAdAccountId === "string") {
    data.metaAdAccountId = data.metaAdAccountId.trim().replace(/^act_/i, "") || null;
  }

  const updated = await prisma.client.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Cliente no encontrado");

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: META_SELECT
  });
  return NextResponse.json(client);
});
