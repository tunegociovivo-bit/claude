import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhone } from "./waha";
import { normalizeEmail } from "./email-verification";

export type SuppressionKind = "lead" | "email" | "phone";

export function suppressionHash(kind: SuppressionKind, raw: string): string {
  const normalized = kind === "email"
    ? normalizeEmail(raw)
    : kind === "phone"
      ? normalizePhone(raw, "34")
      : raw.trim();
  return createHash("sha256").update(`${kind}:${normalized ?? raw.trim().toLowerCase()}`).digest("hex");
}

export async function addSuppression(opts: {
  workspaceId: string;
  leadId?: string | null;
  kind: SuppressionKind;
  value: string;
  reason: string;
  source: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.leadSuppression.upsert({
    where: {
      workspaceId_kind_valueHash: {
        workspaceId: opts.workspaceId,
        kind: opts.kind,
        valueHash: suppressionHash(opts.kind, opts.value)
      }
    },
    create: {
      workspaceId: opts.workspaceId,
      leadId: opts.leadId ?? null,
      kind: opts.kind,
      valueHash: suppressionHash(opts.kind, opts.value),
      reason: opts.reason,
      source: opts.source,
      metadata: opts.metadata
    },
    update: { leadId: opts.leadId ?? undefined, reason: opts.reason, source: opts.source, metadata: opts.metadata }
  });
}

export async function isLeadSuppressed(opts: {
  workspaceId: string;
  leadId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<boolean> {
  const filters: Array<{ kind: string; valueHash: string }> = [];
  if (opts.leadId) filters.push({ kind: "lead", valueHash: suppressionHash("lead", opts.leadId) });
  if (opts.email) filters.push({ kind: "email", valueHash: suppressionHash("email", opts.email) });
  if (opts.phone) filters.push({ kind: "phone", valueHash: suppressionHash("phone", opts.phone) });
  if (!filters.length) return false;
  const match = await prisma.leadSuppression.findFirst({ where: { workspaceId: opts.workspaceId, OR: filters }, select: { id: true } });
  if (match) return true;
  // Compatibilidad con bajas anteriores a LeadSuppression: si el opt-out
  // legacy estaba ligado al lead, bloquea también el nuevo canal email.
  if (opts.leadId) {
    const linkedOptout = await prisma.leadOptout.findFirst({
      where: { workspaceId: opts.workspaceId, leadId: opts.leadId },
      select: { id: true }
    });
    if (linkedOptout) return true;
  }
  if (!opts.phone) return false;
  const normalizedPhone = normalizePhone(opts.phone, "34");
  if (!normalizedPhone) return false;
  return !!(await prisma.leadOptout.findUnique({
    where: { workspaceId_phone: { workspaceId: opts.workspaceId, phone: normalizedPhone } },
    select: { id: true }
  }));
}
