/**
 * Genera un dump JSON con todos los datos del workspace. Pensado para
 * backups de seguridad: la BD entera del workspace en un solo archivo.
 *
 * No incluye:
 * - PasswordHashes (sensibles, no son útiles fuera del Hub)
 * - PushSubscription keys (sirven para cada navegador, regenerables)
 * - Files binarios (solo metadata; los binarios viven en R2)
 *
 * Devuelve un Buffer con el JSON. El que llama puede meterlo en un ZIP.
 */

import { prisma } from "@/lib/db/prisma";

export type DumpResult = {
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  counts: Record<string, number>;
  data: Record<string, any[]>;
};

const STRIP_KEYS = new Set(["passwordHash", "p256dh", "authKey"]);

function strip<T extends object>(row: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(row as any)) {
    if (STRIP_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out as T;
}

export async function generateWorkspaceDump(workspaceId: string): Promise<DumpResult> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new Error("Workspace no encontrado");

  // Para cada modelo, query restringida al workspace o a sus referencias.
  const [
    memberships,
    clients,
    projects,
    projectMembers,
    tasks,
    taskAssignees,
    taskTags,
    tags,
    comments,
    files,
    events,
    documents,
    blocks,
    reviewClients,
    reviewHistory,
    voiceBusinesses,
    apiKeys,
    notifications,
    aiUsage
  ] = await Promise.all([
    prisma.membership.findMany({ where: { workspaceId } }),
    prisma.client.findMany({ where: { workspaceId } }),
    prisma.project.findMany({ where: { workspaceId } }),
    prisma.projectMember.findMany({ where: { project: { workspaceId } } }),
    prisma.task.findMany({ where: { workspaceId } }),
    prisma.taskAssignee.findMany({ where: { task: { workspaceId } } }),
    prisma.taskTag.findMany({ where: { task: { workspaceId } } }),
    prisma.tag.findMany({ where: { workspaceId } }),
    prisma.comment.findMany({ where: { workspaceId } }),
    prisma.file.findMany({ where: { workspaceId } }),
    prisma.calendarEvent.findMany({ where: { workspaceId } }),
    prisma.document.findMany({ where: { workspaceId } }),
    prisma.block.findMany({ where: { document: { workspaceId } } }),
    prisma.reviewClient.findMany({ where: { workspaceId } }),
    prisma.reviewHistory.findMany({ where: { client: { workspaceId } } }),
    prisma.voiceBusiness.findMany({ where: { workspaceId } }),
    prisma.apiKey.findMany({ where: { workspaceId }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, createdAt: true } }),
    prisma.notification.findMany({ where: { user: { memberships: { some: { workspaceId } } } } }),
    prisma.aiUsage.findMany({ where: { workspaceId } })
  ]);

  // Users del workspace (sin password)
  const userRows = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId } } }
  });

  const data = {
    workspace: strip(ws as any),
    users: userRows.map(strip),
    memberships,
    clients,
    projects,
    projectMembers,
    tasks,
    taskAssignees,
    taskTags,
    tags,
    comments,
    files: files.map((f) => ({ ...f, note: "binary lives in R2 under s3Key" })),
    events,
    documents,
    blocks,
    reviewClients,
    reviewHistory,
    voiceBusinesses,
    apiKeys,
    notifications,
    aiUsage
  };

  return {
    generatedAt: new Date().toISOString(),
    workspaceId,
    workspaceName: ws.name,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])),
    data
  };
}
