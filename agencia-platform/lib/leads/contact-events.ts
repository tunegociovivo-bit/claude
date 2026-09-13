import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export async function recordLeadContactEvent(opts: {
  workspaceId: string;
  leadId?: string | null;
  prospectId?: string | null;
  channel: string;
  type: string;
  provider?: string;
  providerEventId?: string;
  externalMessageId?: string | null;
  occurredAt?: Date;
  metadata?: Prisma.InputJsonValue;
}) {
  if (opts.provider && opts.providerEventId) {
    return prisma.leadContactEvent.upsert({
      where: { workspaceId_provider_providerEventId: { workspaceId: opts.workspaceId, provider: opts.provider, providerEventId: opts.providerEventId } },
      create: { ...opts, occurredAt: opts.occurredAt ?? new Date() },
      update: {}
    });
  }
  return prisma.leadContactEvent.create({ data: { ...opts, occurredAt: opts.occurredAt ?? new Date() } });
}
