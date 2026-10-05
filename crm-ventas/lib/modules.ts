import { prisma } from "@/lib/prisma";

// Módulos opcionales del CRM. Se activan por workspace desde el panel de
// operador y se guardan en Workspace.settings.modules.
export const CONTENT_MODULES = ["editorial", "seo"] as const;
export type ContentModule = (typeof CONTENT_MODULES)[number];

export const MODULE_LABELS: Record<ContentModule, string> = {
  editorial: "Editorial",
  seo: "Publicador SEO",
};

export type EnabledModules = Record<ContentModule, boolean>;

export function readModules(settings: unknown): EnabledModules {
  const raw = (settings && typeof settings === "object" ? (settings as any).modules : null) ?? {};
  return {
    editorial: raw.editorial === true,
    seo: raw.seo === true,
  };
}

export async function getEnabledModules(workspaceId: string): Promise<EnabledModules> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  return readModules(ws?.settings);
}

export async function isModuleEnabled(workspaceId: string, module: ContentModule): Promise<boolean> {
  return (await getEnabledModules(workspaceId))[module];
}

// Activa/desactiva módulos conservando el resto de settings. Lectura y
// escritura en la misma transacción para no pisar cambios concurrentes de
// otras partes de settings (Paula, WhatsApp, branding…).
export async function setModules(workspaceId: string, patch: Partial<EnabledModules>): Promise<EnabledModules> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT "settings" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("Workspace no encontrado");
    const settings = { ...((rows[0].settings as Record<string, unknown>) ?? {}) };
    const next = { ...readModules(settings) };
    for (const key of CONTENT_MODULES) {
      if (typeof patch[key] === "boolean") next[key] = patch[key] as boolean;
    }
    settings.modules = next;
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: settings as any } });
    return next;
  });
}
