import type { Prisma } from "@prisma/client";

/** Execute the advisory lock without deserializing PostgreSQL's void value. */
export async function acquireConversationTaskLock(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  identityKey: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))`;
}

/** Consulta canónica para recuperar la tarea creada desde una conversación. */
export function conversationTaskWhere(
  workspaceId: string,
  phones: string[],
  leadIds: string[]
): Prisma.TaskWhereInput {
  const aliases = [...new Set(phones.map((value) => value.trim()).filter(Boolean))];
  const ids = [...new Set(leadIds.map((value) => value.trim()).filter(Boolean))];
  return {
    workspaceId,
    deletedAt: null,
    AND: [
      { customData: { path: ["source"], equals: "leads" } },
      {
        OR: [
          ...aliases.map((value) => ({ customData: { path: ["leadPhone"], equals: value } })),
          ...ids.map((value) => ({ customData: { path: ["leadId"], equals: value } }))
        ]
      }
    ]
  };
}
