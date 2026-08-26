import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isStorageEnabled, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const nullableText = (max = 300) => z.string().max(max).nullable().optional();
const vaultSchema = z.object({
  representativeName: nullableText(), representativeSurnames: nullableText(), representativeId: nullableText(),
  representativeRole: nullableText(), representativeEmail: nullableText(), representativePhone: nullableText(),
  companyTaxId: nullableText(), legalName: nullableText(), tradeName: nullableText(), legalForm: nullableText(),
  address: nullableText(500), postalCode: nullableText(), city: nullableText(), province: nullableText(), country: nullableText(),
  website: nullableText(500), cnae: nullableText(), iae: nullableText(), foundingDate: nullableText(), employeeCount: nullableText(),
  annualTurnover: nullableText(), companyDescription: nullableText(3000),
  isSme: z.enum(["", "yes", "no"]).optional(), isPhysicalPerson: z.enum(["", "yes", "no"]).optional(),
  taxUpToDate: z.enum(["", "yes", "no"]).optional(), socialSecurityUpToDate: z.enum(["", "yes", "no"]).optional(),
  deMinimisAmount: nullableText(), declarationsUpdatedAt: nullableText()
});

async function requireWorkspaceAdmin(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthorized", "Autenticación requerida");
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId },
    select: { role: true }
  });
  if (membership?.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo los administradores pueden acceder a la bóveda de solicitudes");
  }
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireWorkspaceAdmin(api.workspaceId, api.userId);
  const [workspace, files] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } }),
    prisma.file.findMany({ where: { workspaceId: api.workspaceId, targetType: "SUBVENCION_VAULT" }, orderBy: { createdAt: "desc" } })
  ]);
  const items = await Promise.all(files.map(async (file) => ({
    ...file,
    url: isStorageEnabled() ? await signedDownloadUrl(file.s3Key) : null
  })));
  return NextResponse.json({ profile: (workspace?.settings as any)?.subvenciones?.applicationVault ?? {}, files: items });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireWorkspaceAdmin(api.workspaceId, api.userId);
  const parsed = vaultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace no encontrado");
  const settings: any = workspace.settings ?? {};
  settings.subvenciones = settings.subvenciones ?? {};
  const clean = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
  settings.subvenciones.applicationVault = { ...(settings.subvenciones.applicationVault ?? {}), ...clean, updatedAt: new Date().toISOString() };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, profile: settings.subvenciones.applicationVault });
});
