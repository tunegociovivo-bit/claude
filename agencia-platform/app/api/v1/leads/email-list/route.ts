/**
 * GET /api/v1/leads/email-list?searchId=&source=leads|clients|all&format=csv|json
 *
 * Lista de emails para REMARKETING (subir como Custom Audience a Meta Ads, que
 * hashea los emails en su lado). Combina emails de leads (extraídos de sus webs)
 * y de clientes, deduplicados. Solo emails de empresa con base legítima B2B; el
 * uso debe respetar el derecho de oposición (RGPD).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { suppressionHash } from "@/lib/leads/suppressions";
import { normalizePhone } from "@/lib/leads/waha";

type ExportCandidate = {
  email: string;
  name: string;
  phone: string | null;
  origin: "lead" | "client";
  leadId?: string;
};

async function removeSuppressed(workspaceId: string, candidates: ExportCandidate[]): Promise<ExportCandidate[]> {
  const allowed: ExportCandidate[] = [];
  const chunkSize = 750;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    const leadIds = [...new Set(chunk.flatMap((item) => item.leadId ? [item.leadId] : []))];
    const emails = [...new Set(chunk.map((item) => item.email))];
    const phones = [...new Set(chunk.flatMap((item) => {
      const phone = normalizePhone(item.phone, "34");
      return phone ? [phone] : [];
    }))];
    const emailHashes = emails.map((email) => suppressionHash("email", email));
    const phoneHashes = phones.map((phone) => suppressionHash("phone", phone));
    const leadHashes = leadIds.map((leadId) => suppressionHash("lead", leadId));

    const suppressionOr: any[] = [];
    if (emailHashes.length) suppressionOr.push({ kind: "email", valueHash: { in: emailHashes } });
    if (phoneHashes.length) suppressionOr.push({ kind: "phone", valueHash: { in: phoneHashes } });
    if (leadHashes.length) suppressionOr.push({ kind: "lead", valueHash: { in: leadHashes } });

    const [suppressions, legacyOptouts] = await Promise.all([
      suppressionOr.length
        ? prisma.leadSuppression.findMany({
            where: { workspaceId, OR: suppressionOr },
            select: { kind: true, valueHash: true }
          })
        : Promise.resolve([]),
      leadIds.length || phones.length
        ? prisma.leadOptout.findMany({
            where: {
              workspaceId,
              OR: [
                ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []),
                ...(phones.length ? [{ phone: { in: phones } }] : [])
              ]
            },
            select: { leadId: true, phone: true }
          })
        : Promise.resolve([])
    ]);

    const blockedEmails = new Set(suppressions.filter((row) => row.kind === "email").map((row) => row.valueHash));
    const blockedPhones = new Set(suppressions.filter((row) => row.kind === "phone").map((row) => row.valueHash));
    const blockedLeads = new Set(suppressions.filter((row) => row.kind === "lead").map((row) => row.valueHash));
    const legacyLeadIds = new Set(legacyOptouts.flatMap((row) => row.leadId ? [row.leadId] : []));
    const legacyPhones = new Set(legacyOptouts.map((row) => row.phone));

    for (const item of chunk) {
      const phone = normalizePhone(item.phone, "34");
      if (blockedEmails.has(suppressionHash("email", item.email))) continue;
      if (phone && (blockedPhones.has(suppressionHash("phone", phone)) || legacyPhones.has(phone))) continue;
      if (item.leadId && (blockedLeads.has(suppressionHash("lead", item.leadId)) || legacyLeadIds.has(item.leadId))) continue;
      allowed.push(item);
    }
  }

  return allowed;
}

function csvCell(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? undefined;
  const source = url.searchParams.get("source") ?? "all";
  const format = url.searchParams.get("format") ?? "csv";

  const candidates: ExportCandidate[] = [];
  const rows: { email: string; name: string; phone: string | null; origin: string }[] = [];
  const seen = new Set<string>();
  const collect = (email: string | null, name: string, phone: string | null, origin: "lead" | "client", leadId?: string) => {
    const e = (email ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return;
    candidates.push({ email: e, name, phone, origin, leadId });
  };

  if (source === "leads" || source === "all") {
    const where: any = {
      workspaceId: api.workspaceId,
      email: { not: null },
      emailVerificationStatus: "deliverable",
      contactStatus: { notIn: ["excluded", "discarded", "client", "responded"] }
    };
    if (searchId) where.searchId = searchId;
    const leads = await prisma.lead.findMany({ where, select: { id: true, email: true, name: true, phone: true }, take: 20000 });
    for (const lead of leads) collect(lead.email, lead.name, lead.phone, "lead", lead.id);
  }
  if (source === "clients" || source === "all") {
    const clients = await prisma.client.findMany({
      where: { workspaceId: api.workspaceId, email: { not: null }, deletedAt: null },
      select: { email: true, name: true, phone: true },
      take: 20000
    });
    for (const client of clients) collect(client.email, client.name, client.phone, "client");
  }

  for (const candidate of await removeSuppressed(api.workspaceId, candidates)) {
    if (seen.has(candidate.email)) continue;
    seen.add(candidate.email);
    rows.push({ email: candidate.email, name: candidate.name, phone: candidate.phone, origin: candidate.origin });
  }

  if (format === "json") {
    return NextResponse.json({ total: rows.length, items: rows });
  }

  const header = ["email", "nombre", "telefono", "origen"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.email, r.name, r.phone ?? "", r.origin].map(csvCell).join(","));
  const csv = "﻿" + lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="emails-remarketing-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
});
