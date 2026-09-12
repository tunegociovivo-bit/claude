/**
 * Módulo Empleos — cola de revisión.
 *
 *  GET  → lista los emails redactados que esperan aprobación manual (modo review)
 *         + todas las ofertas detectadas, aunque todavía no tengan email.
 *  POST → acción en LOTE sobre los seleccionados:
 *         { action: "approve", items: [{ id, subject?, body? }] } → envía cada uno
 *         { action: "reject",  items: [{ id }] }                   → descarta cada uno
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { listPendingReview, approveExecOutreach, rejectExecOutreach } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await listPendingReview(api.workspaceId);
  const pendingDraftLeadIds = new Set(items.map((item) => item.leadId));
  let detectedOffers: Array<{
    id: string;
    company: string;
    jobTitle: string | null;
    location: string | null;
    jobUrl: string | null;
    board: string | null;
    hasEmail: boolean;
    hasDraft: boolean;
    contactStatus: string;
    detectedAt: string;
  }> = [];
  let totalDetectedOffers = 0;
  let noEmailCount = 0;

  try {
    const jobsWhere = {
      workspaceId: api.workspaceId,
      rawData: { path: ["source"], equals: "jobs" }
    } as const;
    const [jobLeads, total, withoutEmail] = await Promise.all([
      prisma.lead.findMany({
        where: jobsWhere,
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          name: true,
          province: true,
          formattedAddress: true,
          email: true,
          contactStatus: true,
          rawData: true,
          createdAt: true
        }
      }),
      prisma.lead.count({ where: jobsWhere }),
      prisma.lead.count({
        where: {
          workspaceId: api.workspaceId,
          email: null,
          contactStatus: { in: ["pending", "excluded"] },
          rawData: { path: ["source"], equals: "jobs" }
        }
      })
    ]);

    detectedOffers = jobLeads.map((lead) => {
      const rawData = (lead.rawData && typeof lead.rawData === "object" && !Array.isArray(lead.rawData))
        ? lead.rawData as Record<string, unknown>
        : {};
      const rawJobUrl = typeof rawData.jobUrl === "string" ? rawData.jobUrl : null;
      return {
        id: lead.id,
        company: lead.name,
        jobTitle: typeof rawData.jobTitle === "string" ? rawData.jobTitle : null,
        location: lead.formattedAddress ?? lead.province,
        jobUrl: rawJobUrl && /^https?:\/\//i.test(rawJobUrl) ? rawJobUrl : null,
        board: typeof rawData.board === "string" ? rawData.board : null,
        hasEmail: Boolean(lead.email),
        hasDraft: pendingDraftLeadIds.has(lead.id),
        contactStatus: lead.contactStatus,
        detectedAt: lead.createdAt.toISOString()
      };
    });
    totalDetectedOffers = total;
    noEmailCount = withoutEmail;
  } catch {
    detectedOffers = [];
    totalDetectedOffers = 0;
    noEmailCount = 0;
  }
  return NextResponse.json({ items, detectedOffers, totalDetectedOffers, noEmailCount });
});

const bulkSchema = z.object({
  action: z.enum(["approve", "reject"]),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        subject: z.string().max(300).optional(),
        body: z.string().max(8000).optional()
      })
    )
    .min(1)
    .max(200)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = bulkSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { action, items } = parsed.data;

  let ok = 0;
  const errors: { id: string; message: string }[] = [];

  for (const it of items) {
    try {
      if (action === "reject") {
        await rejectExecOutreach(api.workspaceId, it.id);
      } else {
        await approveExecOutreach(api.workspaceId, it.id, { subject: it.subject, body: it.body });
      }
      ok++;
    } catch (e: any) {
      errors.push({ id: it.id, message: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({ ok, failed: errors.length, errors, action });
});
