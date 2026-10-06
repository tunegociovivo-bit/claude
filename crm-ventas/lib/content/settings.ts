import { prisma } from "@/lib/prisma";

/**
 * Modifica Workspace.settings de forma atómica (SELECT … FOR UPDATE) para no
 * pisar cambios concurrentes de otras partes del CRM (Paula, WhatsApp, logo,
 * módulos…). `mutate` recibe una copia y la modifica en sitio.
 */
export async function patchWorkspaceSettings(
  workspaceId: string,
  mutate: (settings: Record<string, any>) => void
): Promise<Record<string, any>> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT "settings" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("Workspace no encontrado");
    const settings = JSON.parse(JSON.stringify(rows[0].settings ?? {})) as Record<string, any>;
    mutate(settings);
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: settings as any } });
    return settings;
  });
}

export async function readWorkspaceSettings(workspaceId: string): Promise<Record<string, any>> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  return ((ws?.settings as Record<string, any>) ?? {}) as Record<string, any>;
}
