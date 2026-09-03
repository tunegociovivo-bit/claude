/**
 * Cliente Google Search Console (Webmasters v3) — read-only.
 *
 * Mismo refresh token de GoogleAdsConnection. Necesita scope
 * `https://www.googleapis.com/auth/webmasters.readonly`.
 *
 * El siteUrl es la propiedad como está en Search Console. Ejemplos:
 *   - "sc-domain:negociovivo.app" (Domain property)
 *   - "https://negociovivo.app/" (URL prefix property, con barra final)
 *
 * Config:
 *   - Por cliente: Client.settings.gscSiteUrl
 *   - Por workspace: Workspace.settings.integrations.searchConsole.defaultSiteUrl
 *
 * Docs: https://developers.google.com/webmaster-tools/v1/api_reference_index
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const BASE = "https://searchconsole.googleapis.com/webmasters/v3";

async function getAccessToken(workspaceId: string): Promise<string> {
  const conn = await prisma.googleAdsConnection.findFirst({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  if (!conn) throw new Error("Falta conexión Google. Necesaria para Search Console.");
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (!refreshToken) throw new Error("refresh token inválido");
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_ADS_CLIENT_ID/SECRET no en env");
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error(`Google OAuth refresh ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.access_token as string;
}

async function resolveSiteUrl(opts: {
  workspaceId: string;
  siteUrl?: string | null;
  clientId?: string | null;
}): Promise<string> {
  if (opts.siteUrl) return opts.siteUrl;
  if (opts.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId }
    });
    const su = (c as any)?.settings?.gscSiteUrl;
    if (su) return String(su);
  }
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const wsSu = (ws?.settings as any)?.integrations?.searchConsole?.defaultSiteUrl;
  if (wsSu) return String(wsSu);
  throw new Error(
    "Search Console siteUrl no encontrado. Pásalo en la tool o configura Client.settings.gscSiteUrl."
  );
}

function defaultDateRange(opts: { since?: string; until?: string; datePreset?: string }) {
  if (opts.since && opts.until) return { startDate: opts.since, endDate: opts.until };
  const today = new Date();
  const end = new Date(today.getTime() - 2 * 86400_000); // GSC tiene lag de ~2 días
  const days =
    opts.datePreset === "last_7_days"
      ? 7
      : opts.datePreset === "last_90_days"
        ? 90
        : 30;
  const start = new Date(end.getTime() - days * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function searchConsoleQuery(opts: {
  workspaceId: string;
  siteUrl?: string;
  clientId?: string;
  since?: string;
  until?: string;
  datePreset?: string;
  /** "query" → top búsquedas; "page" → top URLs; "country" → países */
  dimensions?: Array<"query" | "page" | "country" | "device" | "date">;
  rowLimit?: number;
}) {
  const siteUrl = await resolveSiteUrl({
    workspaceId: opts.workspaceId,
    siteUrl: opts.siteUrl,
    clientId: opts.clientId
  });
  const token = await getAccessToken(opts.workspaceId);
  const { startDate, endDate } = defaultDateRange(opts);
  const body = {
    startDate,
    endDate,
    dimensions: opts.dimensions ?? ["query"],
    rowLimit: opts.rowLimit ?? 25
  };
  const r = await fetch(
    `${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  if (!r.ok) throw new Error(`Search Console ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const rows = (data.rows ?? []).map((row: any) => {
    const out: Record<string, any> = {};
    (body.dimensions ?? []).forEach((d, i) => {
      out[d] = row.keys?.[i];
    });
    out.clicks = Number(row.clicks ?? 0);
    out.impressions = Number(row.impressions ?? 0);
    out.ctr = Number(row.ctr ?? 0);
    out.position = Number(row.position ?? 0);
    return out;
  });
  return { siteUrl, startDate, endDate, dimensions: body.dimensions, rowCount: rows.length, rows };
}
