import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import { extractEmailCandidatesFromWebsite } from "./email-extract";
import { emailCandidateScore, emailMatchesWebsiteDomain, isAllowedWebsiteContactEmail, isEligibleOutreachEmail, normalizeEmail, verifyEmailAddress } from "./email-verification";
import { ensureLeadMultichannelCadence } from "./lead-cadence";
import { resolveContactKeys } from "./enrich-contacts";
import { nextUtcDay, verifyMailboxCached } from "./email-verification-cache";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type CheckedCandidate = {
  email: string;
  verificationStatus: string;
  score: number;
  provider: "dns" | "hunter";
  sourceUrl: string | null;
  extractionMethod: "mailto" | "text" | null;
  pageKind: "home" | "contact" | "other" | null;
};

async function refreshSearchCounters(searchId: string | null) {
  if (!searchId) return;
  const groups = await prisma.lead.groupBy({
    by: ["emailEnrichmentStatus"],
    where: { searchId },
    _count: { _all: true }
  });
  const count = (statuses: string[]) => groups
    .filter((row) => statuses.includes(row.emailEnrichmentStatus))
    .reduce((sum, row) => sum + row._count._all, 0);
  await prisma.leadSearch.updateMany({
    where: { id: searchId },
    data: {
      emailEnrichmentTotal: count(["queued", "processing", "found", "no_email", "no_website", "failed"]),
      emailEnrichmentProcessed: count(["found", "no_email", "no_website", "failed"]),
      emailEnrichmentFound: count(["found"]),
      emailEnrichmentFailed: count(["failed"])
    }
  });
}

class StaleEnrichmentSnapshotError extends Error {}

async function markFailure(lead: { id: string; searchId: string | null; emailEnrichmentAttempts: number }, leaseOwner: string, error: unknown) {
  const attempts = lead.emailEnrichmentAttempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const updated = await prisma.lead.updateMany({
    where: { id: lead.id, emailEnrichmentStatus: "processing", emailEnrichmentLeaseOwner: leaseOwner },
    data: {
      emailEnrichmentStatus: terminal ? "failed" : "queued",
      emailEnrichmentAttempts: attempts,
      emailEnrichmentNextAt: terminal ? null : new Date(Date.now() + RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]),
      emailEnrichmentLeaseUntil: null,
      emailEnrichmentLeaseOwner: null,
      emailEnrichmentError: String((error as any)?.message ?? error).slice(0, 1000)
    }
  });
  if (updated.count) await refreshSearchCounters(lead.searchId);
}

async function processLead(lead: {
  id: string;
  workspaceId: string;
  searchId: string | null;
  website: string | null;
  email: string | null;
  emailSource: string | null;
  emailVerificationStatus: string | null;
  emailEnrichmentStatus: string;
  emailEnrichmentAttempts: number;
  contactStatus: string;
}, leaseOwner: string) {
  try {
    const { hunterKey, hunterDailyLimit } = await resolveContactKeys(lead.workspaceId);
    const candidates = new Map<string, { sourceUrl: string | null; extractionMethod: "mailto" | "text" | null; pageKind: "home" | "contact" | "other" | null }>();
    const existingEmail = normalizeEmail(lead.email);
    if (existingEmail && isEligibleOutreachEmail(existingEmail) && emailMatchesWebsiteDomain(existingEmail, lead.website)) {
      candidates.set(existingEmail, { sourceUrl: lead.website, extractionMethod: null, pageKind: null });
    }
    const mailboxRetry = lead.emailEnrichmentStatus === "found" && !!existingEmail && lead.emailVerificationStatus !== "deliverable";
    if (mailboxRetry) {
      const previousCandidates = await prisma.leadEmailContact.findMany({
        where: { leadId: lead.id },
        orderBy: [{ score: "desc" }, { discoveredAt: "asc" }],
        select: { normalizedEmail: true, sourceUrl: true, metadata: true }
      });
      previousCandidates.forEach((candidate) => {
        const email = normalizeEmail(candidate.normalizedEmail);
        const metadata = (candidate.metadata as any) ?? {};
        const evidence = {
          sourceUrl: candidate.sourceUrl,
          extractionMethod: metadata.extractionMethod === "mailto" || metadata.extractionMethod === "text" ? metadata.extractionMethod : null,
          pageKind: ["home", "contact", "other"].includes(metadata.pageKind) ? metadata.pageKind as "home" | "contact" | "other" : null
        };
        if (email && isAllowedWebsiteContactEmail(email, lead.website, { method: evidence.extractionMethod, pageKind: evidence.pageKind })) candidates.set(email, evidence);
      });
    }
    if (lead.website && !mailboxRetry) {
      for (const candidate of await extractEmailCandidatesFromWebsite(lead.website)) {
        const email = normalizeEmail(candidate.email);
        if (email && isAllowedWebsiteContactEmail(email, lead.website, candidate)) {
          candidates.set(email, { sourceUrl: candidate.sourceUrl, extractionMethod: candidate.method, pageKind: candidate.pageKind });
        }
      }
    }

    const verified: CheckedCandidate[] = await Promise.all([...candidates.entries()].slice(0, 8).map(async ([email, evidence]) => ({
      email,
      verificationStatus: await verifyEmailAddress(email),
      score: emailCandidateScore(email, lead.website),
      provider: "dns" as const,
      ...evidence
    })));
    verified.sort((a, b) => b.score - a.score);
    let verificationDeferred = false;
    let verificationRetryAt: Date | null = null;
    let mailboxChecks = 0;
    if (hunterKey) {
      for (const candidate of verified) {
        if (candidate.verificationStatus !== "domain_mx_valid") continue;
        const mailbox = await verifyMailboxCached({ workspaceId: lead.workspaceId, email: candidate.email, hunterKey, dailyLimit: hunterDailyLimit, allowProviderCall: mailboxChecks < 2 });
        if (mailbox.providerCallConsumed) mailboxChecks++;
        candidate.verificationStatus = mailbox.status;
        candidate.provider = mailbox.status === "domain_mx_valid" ? "dns" : "hunter";
        verificationDeferred ||= mailbox.deferred;
        if (mailbox.retryAt && (!verificationRetryAt || mailbox.retryAt < verificationRetryAt)) verificationRetryAt = mailbox.retryAt;
        if (mailbox.status === "deliverable") break;
      }
    }
    if (hunterKey && !verified.some((candidate) => candidate.verificationStatus === "deliverable") && verified.some((candidate) => candidate.verificationStatus === "domain_mx_valid")) {
      verificationDeferred = true;
      verificationRetryAt ??= new Date(Date.now() + 5 * 60_000);
    }
    verified.sort((a, b) => {
      const rank = (status: string) => status === "deliverable" ? 3 : status === "risky" ? 2 : status === "domain_mx_valid" ? 1 : 0;
      const verifiedDiff = rank(b.verificationStatus) - rank(a.verificationStatus);
      return verifiedDiff || b.score - a.score;
    });
    if (!verified.some((candidate) => ["deliverable", "risky", "domain_mx_valid"].includes(candidate.verificationStatus)) && verified.some((candidate) => candidate.verificationStatus === "unknown")) {
      throw new Error("Verificación DNS temporalmente no disponible");
    }

    await prisma.$transaction(async (tx) => {
      const primary = verified[0] ?? null;
      const persisted = await tx.lead.updateMany({
        where: {
          id: lead.id,
          emailEnrichmentStatus: "processing",
          emailEnrichmentLeaseOwner: leaseOwner,
          website: lead.website,
          email: lead.email,
          emailSource: lead.emailSource,
          emailVerificationStatus: lead.emailVerificationStatus,
          contactStatus: lead.contactStatus
        },
        data: {
          email: primary?.email ?? null,
          emailSource: primary ? (primary.email === existingEmail && lead.emailSource === "source" ? "source" : "website") : null,
          emailVerificationStatus: primary?.verificationStatus ?? null,
          emailVerifiedAt: primary ? new Date() : null,
          emailEnrichmentStatus: primary ? "found" : lead.website ? "no_email" : "no_website",
          // Contador de fallos consecutivos; un resultado persistido (aunque
          // quede pendiente de cuota) rompe la racha de error.
          emailEnrichmentAttempts: 0,
          emailEnrichmentNextAt: verificationDeferred && primary?.verificationStatus !== "deliverable" ? (verificationRetryAt ?? nextUtcDay(new Date())) : null,
          emailEnrichmentLeaseUntil: null,
          emailEnrichmentLeaseOwner: null,
          emailEnrichmentError: null,
          multichannelEnrollmentStatus: "queued",
          multichannelEnrollmentNextAt: new Date(),
          multichannelEnrollmentLeaseUntil: null,
          multichannelEnrollmentError: null
        }
      });
      if (!persisted.count) throw new StaleEnrichmentSnapshotError("La ficha cambió durante el enriquecimiento");

      await tx.leadEmailContact.updateMany({ where: { leadId: lead.id }, data: { isPrimary: false } });
      for (let index = 0; index < verified.length; index++) {
        const candidate = verified[index];
        await tx.leadEmailContact.upsert({
          where: { leadId_normalizedEmail: { leadId: lead.id, normalizedEmail: candidate.email } },
          create: {
            workspaceId: lead.workspaceId,
            leadId: lead.id,
            email: candidate.email,
            normalizedEmail: candidate.email,
            isPrimary: index === 0,
            sourceType: candidate.email === existingEmail && lead.emailSource === "source" ? "source" : "website",
            sourceUrl: candidate.sourceUrl ?? lead.website,
            sourceDomain: candidate.email.split("@")[1],
            verificationStatus: candidate.verificationStatus,
            verificationProvider: candidate.provider,
            score: candidate.score,
            verifiedAt: new Date(),
            metadata: { extractionMethod: candidate.extractionMethod, pageKind: candidate.pageKind }
          },
          update: {
            isPrimary: index === 0,
            verificationStatus: candidate.verificationStatus,
            verificationProvider: candidate.provider,
            score: candidate.score,
            verifiedAt: new Date(),
            sourceUrl: candidate.sourceUrl ?? lead.website,
            metadata: { extractionMethod: candidate.extractionMethod, pageKind: candidate.pageKind }
          }
        });
      }

    });

    await refreshSearchCounters(lead.searchId);
    return verified[0] ? "found" : "empty";
  } catch (error) {
    if (error instanceof StaleEnrichmentSnapshotError) {
      const requeued = await prisma.lead.updateMany({
        where: { id: lead.id, emailEnrichmentStatus: "processing", emailEnrichmentLeaseOwner: leaseOwner },
        data: {
          emailEnrichmentStatus: "queued",
          emailEnrichmentNextAt: new Date(),
          emailEnrichmentLeaseUntil: null,
          emailEnrichmentLeaseOwner: null,
          emailEnrichmentError: "Ficha modificada durante el rastreo; se recalculará"
        }
      });
      if (requeued.count) await refreshSearchCounters(lead.searchId);
      return "stale";
    }
    await markFailure(lead, leaseOwner, error);
    return "failed";
  }
}

export async function processCadenceEnrollmentTick(workspaceId: string, batchSize = 6) {
  const now = new Date();
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId,
      search: { source: "places" },
      contactStatus: "pending",
      emailEnrichmentStatus: { in: ["found", "no_email", "no_website"] },
      OR: [
        { multichannelEnrollmentStatus: "queued", OR: [{ multichannelEnrollmentNextAt: null }, { multichannelEnrollmentNextAt: { lte: now } }] },
        { multichannelEnrollmentStatus: "processing", OR: [{ multichannelEnrollmentLeaseUntil: null }, { multichannelEnrollmentLeaseUntil: { lt: now } }] },
        { multichannelEnrollmentStatus: "failed", multichannelEnrollmentNextAt: { lte: now } }
      ]
    },
    select: { id: true, multichannelEnrollmentAttempts: true },
    orderBy: { updatedAt: "asc" },
    take: Math.max(1, Math.min(batchSize, 20))
  });
  let enrolled = 0;
  let deferred = 0;
  let skipped = 0;
  let failed = 0;
  for (const lead of leads) {
    const claimed = await prisma.lead.updateMany({
      where: {
        id: lead.id,
        multichannelEnrollmentStatus: { in: ["queued", "processing", "failed"] },
        OR: [{ multichannelEnrollmentLeaseUntil: null }, { multichannelEnrollmentLeaseUntil: { lt: now } }]
      },
      data: { multichannelEnrollmentStatus: "processing", multichannelEnrollmentLeaseUntil: new Date(now.getTime() + 10 * 60_000) }
    });
    if (!claimed.count) continue;
    try {
      const result = await ensureLeadMultichannelCadence(lead.id);
      if (result.enrolled || result.reason === "already_enrolled") {
        await prisma.lead.update({ where: { id: lead.id }, data: { multichannelEnrollmentStatus: "enrolled", multichannelEnrollmentNextAt: null, multichannelEnrollmentLeaseUntil: null, multichannelEnrollmentError: null } });
        enrolled++;
      } else if (result.reason === "disabled") {
        await prisma.lead.update({ where: { id: lead.id }, data: { multichannelEnrollmentStatus: "queued", multichannelEnrollmentNextAt: new Date(now.getTime() + 15 * 60_000), multichannelEnrollmentLeaseUntil: null, multichannelEnrollmentError: "Automatización aún desactivada" } });
        deferred++;
      } else {
        await prisma.lead.update({ where: { id: lead.id }, data: { multichannelEnrollmentStatus: "skipped", multichannelEnrollmentNextAt: null, multichannelEnrollmentLeaseUntil: null, multichannelEnrollmentError: result.reason ?? "not_eligible" } });
        skipped++;
      }
    } catch (error) {
      const attempts = lead.multichannelEnrollmentAttempts + 1;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          multichannelEnrollmentStatus: "failed",
          multichannelEnrollmentAttempts: attempts,
          multichannelEnrollmentNextAt: new Date(now.getTime() + RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]),
          multichannelEnrollmentLeaseUntil: null,
          multichannelEnrollmentError: String((error as any)?.message ?? error).slice(0, 1000)
        }
      });
      failed++;
    }
  }
  return { picked: leads.length, enrolled, deferred, skipped, failed };
}

export async function processEmailEnrichmentTick(workspaceId: string, batchSize = 2) {
  const now = new Date();
  const { hunterKey } = await resolveContactKeys(workspaceId);
  const dueStates: any[] = [
    { emailEnrichmentStatus: "queued", OR: [{ emailEnrichmentNextAt: null }, { emailEnrichmentNextAt: { lte: now } }] },
    { emailEnrichmentStatus: "processing", emailEnrichmentLeaseUntil: { lt: now } },
    { emailEnrichmentStatus: "found", emailVerificationStatus: { not: "deliverable" }, emailEnrichmentNextAt: { lte: now } }
  ];
  if (hunterKey) {
    // Cubre claves Hunter añadidas por entorno/despliegue, no solo por PATCH.
    dueStates.push({ emailEnrichmentStatus: "found", emailVerificationStatus: "domain_mx_valid", emailEnrichmentNextAt: null });
  }
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId,
      search: { source: "places" },
      contactStatus: { notIn: ["excluded", "discarded", "client"] },
      OR: dueStates
    },
    select: {
      id: true,
      workspaceId: true,
      searchId: true,
      website: true,
      email: true,
      emailSource: true,
      emailVerificationStatus: true,
      emailEnrichmentStatus: true,
      emailEnrichmentAttempts: true,
      contactStatus: true
    },
    orderBy: [{ ticketScore: "desc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(batchSize, 10))
  });

  const claimedLeads: Array<{ lead: typeof leads[number]; leaseOwner: string }> = [];
  for (const lead of leads) {
    const leaseOwner = randomUUID();
    const claimed = await prisma.lead.updateMany({
      where: {
        id: lead.id,
        workspaceId,
        OR: dueStates
      },
      data: {
        emailEnrichmentStatus: "processing",
        emailEnrichmentLeaseUntil: new Date(Date.now() + 10 * 60_000),
        emailEnrichmentLeaseOwner: leaseOwner
      }
    });
    if (!claimed.count) continue;
    const fresh = await prisma.lead.findFirst({
      where: { id: lead.id, workspaceId, emailEnrichmentStatus: "processing", emailEnrichmentLeaseOwner: leaseOwner },
      select: {
        id: true,
        workspaceId: true,
        searchId: true,
        website: true,
        email: true,
        emailSource: true,
        emailVerificationStatus: true,
        emailEnrichmentStatus: true,
        emailEnrichmentAttempts: true,
        contactStatus: true
      }
    });
    if (fresh) claimedLeads.push({ lead: fresh, leaseOwner });
  }
  const results = await Promise.all(claimedLeads.map(({ lead, leaseOwner }) => processLead(lead, leaseOwner)));
  const enrollment = await processCadenceEnrollmentTick(workspaceId, Math.max(6, batchSize * 2));
  return {
    picked: leads.length,
    processed: results.length,
    found: results.filter((result) => result === "found").length,
    failed: results.filter((result) => result === "failed").length,
    enrollment
  };
}
