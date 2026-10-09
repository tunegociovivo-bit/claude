/**
 * Spreadsheet «Informe GMB» de la ficha.
 *  GET  → URL vinculada, cuenta de servicio con la que hay que compartirla y última sincronización.
 *  POST { url } → guarda la URL, comprueba el acceso y las pestañas, y sincroniza.
 *  POST { action: "sync", backfillMonths? } → añade los meses cerrados que falten.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getSheetsServiceAccount, parseSpreadsheetId } from "@/lib/integrations/google-sheets";
import { syncClientSheet } from "@/lib/gmb/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true, reportSheetUrl: true, reportSheetSyncedAt: true } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const sa = await getSheetsServiceAccount(api.workspaceId).catch((e) => ({ error: String(e?.message ?? e) }) as any);
  return NextResponse.json({ ok: true, url: c.reportSheetUrl, syncedAt: c.reportSheetSyncedAt, serviceAccount: sa?.client_email ?? null, serviceAccountError: sa?.error ?? null });
});

const schema = z.object({
  url: z.string().max(500).optional(),
  action: z.enum(["sync"]).optional(),
  backfillMonths: z.number().int().min(1).max(17).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const b = schema.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new ApiError(400, "validation_error", b.error.message);
  if (b.data.url !== undefined) {
    const url = b.data.url.trim();
    if (url && !/docs\.google\.com\/spreadsheets\/d\/|^[a-zA-Z0-9_-]{25,}$/.test(url)) {
      return NextResponse.json({ ok: false, message: "Pega la URL completa del Google Sheets (docs.google.com/spreadsheets/d/…)." });
    }
    const clean = url ? `https://docs.google.com/spreadsheets/d/${parseSpreadsheetId(url)}/edit` : "";
    await prisma.gmbClient.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { reportSheetUrl: clean, ...(clean ? {} : { reportSheetSyncedAt: null }) } });
    if (!clean) return NextResponse.json({ ok: true, url: "", written: [] });
  }
  try {
    const r = await syncClientSheet(api.workspaceId, c.id, { backfillMonths: b.data.backfillMonths });
    return NextResponse.json({ ...r, syncedAt: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, written: [], message: String(e?.message ?? e).slice(0, 500) });
  }
});
