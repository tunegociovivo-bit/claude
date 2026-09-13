import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH_SIZE = 500;
const BACKFILL_KEY = "leads_multichannel_v1";

const EMAIL_SYNTAX = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// Este script se ejecuta en la etapa runner de Docker, sin depender del alias
// @/* de Next/tsconfig ni cargar integraciones con efectos laterales.
function normalizeEmail(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim().toLowerCase().replace(/^mailto:/, "").split(/[?#]/)[0];
  return email && email.length <= 254 && EMAIL_SYNTAX.test(email) ? email : null;
}

function normalizePhone(value: string | null | undefined, defaultCountryCode = "34"): string | null {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && !digits.startsWith(defaultCountryCode)) digits = `${defaultCountryCode}${digits}`;
  return digits;
}

function valueHash(kind: "lead" | "email" | "phone", raw: string): string {
  const normalized = kind === "email"
    ? normalizeEmail(raw)
    : kind === "phone"
      ? normalizePhone(raw, "34")
      : raw.trim();
  return createHash("sha256").update(`${kind}:${normalized ?? raw.trim().toLowerCase()}`).digest("hex");
}

function rowId(workspaceId: string, kind: string, hash: string): string {
  return `legacy_${createHash("sha256").update(`${workspaceId}:${kind}:${hash}`).digest("hex")}`;
}

async function backfillLegacyLeadEmails(renew: () => Promise<void>) {
  let cursor: string | undefined;
  let created = 0;
  for (;;) {
    const leads = await prisma.lead.findMany({
      where: { email: { not: null } },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, workspaceId: true, email: true }
    });
    if (!leads.length) break;
    await renew();
    const rows = leads.flatMap((lead) => {
      const email = normalizeEmail(lead.email);
      if (!email) return [];
      return [{
        id: `legacy_${createHash("sha256").update(`${lead.id}:${email}`).digest("hex")}`,
        workspaceId: lead.workspaceId,
        leadId: lead.id,
        email,
        normalizedEmail: email,
        isPrimary: true,
        sourceType: "legacy",
        verificationStatus: "unknown",
        verificationProvider: "legacy"
      }];
    });
    if (rows.length) created += (await prisma.leadEmailContact.createMany({ data: rows, skipDuplicates: true })).count;
    cursor = leads.at(-1)!.id;
    if (leads.length < BATCH_SIZE) break;
  }
  return created;
}

async function backfillLegacyOptouts(renew: () => Promise<void>) {
  let cursor: string | undefined;
  let created = 0;
  for (;;) {
    const optouts = await prisma.leadOptout.findMany({
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, workspaceId: true, phone: true, leadId: true, reason: true, createdAt: true }
    });
    if (!optouts.length) break;
    await renew();
    const leadIds = [...new Set(optouts.map((item) => item.leadId).filter((id): id is string => !!id))];
    const leads = leadIds.length ? await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, workspaceId: true, email: true, emailContacts: { select: { normalizedEmail: true } } }
    }) : [];
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
    const rows = new Map<string, {
      id: string; workspaceId: string; leadId: string | null; kind: string; valueHash: string;
      reason: string; source: string; createdAt: Date;
    }>();
    for (const optout of optouts) {
      const reason = optout.reason ?? "Baja histórica";
      const add = (kind: "lead" | "email" | "phone", raw: string, leadId: string | null) => {
        const hash = valueHash(kind, raw);
        const key = `${optout.workspaceId}:${kind}:${hash}`;
        rows.set(key, { id: rowId(optout.workspaceId, kind, hash), workspaceId: optout.workspaceId, leadId, kind, valueHash: hash, reason, source: "legacy_backfill", createdAt: optout.createdAt });
      };
      add("phone", optout.phone, optout.leadId);
      const lead = optout.leadId ? leadsById.get(optout.leadId) : null;
      if (!lead || lead.workspaceId !== optout.workspaceId) continue;
      add("lead", lead.id, lead.id);
      for (const raw of [lead.email, ...lead.emailContacts.map((contact) => contact.normalizedEmail)]) {
        const email = normalizeEmail(raw);
        if (email) add("email", email, lead.id);
      }
    }
    if (rows.size) created += (await prisma.leadSuppression.createMany({ data: [...rows.values()], skipDuplicates: true })).count;
    cursor = optouts.at(-1)!.id;
    if (optouts.length < BATCH_SIZE) break;
  }
  return created;
}

async function main() {
  const owner = randomUUID();
  const now = new Date();
  const current = await prisma.leadMigrationState.upsert({
    where: { key: BACKFILL_KEY },
    create: { key: BACKFILL_KEY },
    update: {}
  });
  if (current.status === "completed") {
    console.info("[leads-multichannel-backfill] already completed");
    return;
  }
  const claimed = await prisma.leadMigrationState.updateMany({
    where: { key: BACKFILL_KEY, status: { not: "completed" }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { status: "running", leaseOwner: owner, leaseUntil: new Date(now.getTime() + 15 * 60_000) }
  });
  if (!claimed.count) {
    console.info("[leads-multichannel-backfill] another replica owns the lease");
    return;
  }
  const renew = async () => {
    const result = await prisma.leadMigrationState.updateMany({
      where: { key: BACKFILL_KEY, leaseOwner: owner, status: "running" },
      data: { leaseUntil: new Date(Date.now() + 15 * 60_000) }
    });
    if (!result.count) throw new Error("Backfill lease lost");
  };
  try {
    const [legacyContacts, suppressions] = await Promise.all([
      backfillLegacyLeadEmails(renew),
      backfillLegacyOptouts(renew)
    ]);
    await prisma.leadMigrationState.updateMany({
      where: { key: BACKFILL_KEY, leaseOwner: owner },
      data: { status: "completed", completedAt: new Date(), leaseOwner: null, leaseUntil: null, metadata: { legacyContacts, suppressions } }
    });
    console.info(`[leads-multichannel-backfill] contacts=${legacyContacts} suppressions=${suppressions}`);
  } catch (error) {
    await prisma.leadMigrationState.updateMany({
      where: { key: BACKFILL_KEY, leaseOwner: owner },
      data: { status: "pending", leaseOwner: null, leaseUntil: null, metadata: { error: String((error as any)?.message ?? error).slice(0, 1000) } }
    });
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("[leads-multichannel-backfill] error", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
