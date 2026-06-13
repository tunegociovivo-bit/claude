/**
 * POST /api/v1/leads/extract-emails   { searchId?, ids?, limit? }
 *
 * Extracción MASIVA de emails de la web de los leads (lo que GMB no da): para
 * los leads con web y sin email aún, baja su web y guarda el email de contacto.
 * Construye la base para listas de remarketing. Acotado por `limit` (coste).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { extractEmailsFromWebsite } from "@/lib/leads/email-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  searchId: z.string().optional(),
  ids: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(200).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const limit = parsed.data.limit ?? 50;

  const where: any = {
    workspaceId: api.workspaceId,
    email: null,
    website: { not: null },
    contactStatus: { notIn: ["excluded", "discarded"] }
  };
  if (parsed.data.searchId) where.searchId = parsed.data.searchId;
  if (parsed.data.ids?.length) where.id = { in: parsed.data.ids };

  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, website: true },
    take: limit
  });

  let found = 0;
  // Concurrencia limitada para no saturar.
  const queue = [...leads];
  async function worker() {
    for (let lead = queue.shift(); lead; lead = queue.shift()) {
      if (!lead.website) continue;
      const emails = await extractEmailsFromWebsite(lead.website).catch(() => []);
      if (emails[0]) {
        await prisma.lead.update({ where: { id: lead.id }, data: { email: emails[0] } }).catch(() => {});
        found++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, leads.length) }, worker));

  return NextResponse.json({ ok: true, scanned: leads.length, found });
});
