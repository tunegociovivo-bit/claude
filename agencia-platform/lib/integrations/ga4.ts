/**
 * Cliente Google Analytics Data API v1 (GA4) — read-only.
 *
 * Reusa el refresh token de GoogleAdsConnection (asumiendo que el OAuth
 * fue concedido con scope `analytics.readonly` además de `adwords`). Si
 * tu OAuth no incluye ese scope, vuelve a conectar con scopes ampliados.
 *
 * Configuración del propertyId:
 *   - Por cliente: Client.settings.ga4PropertyId
 *   - Por workspace: Workspace.settings.integrations.ga4.defaultPropertyId
 *   - O pasado explícito en la tool.
 *
 * El propertyId es solo el número (sin "properties/"). Ej: "123456789".
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1/rest
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const BASE = "https://analyticsdata.googleapis.com/v1beta";

async function getAccessToken(workspaceId: string): Promise<string> {
  const conn = await prisma.googleAdsConnection.findUnique({ where: { workspaceId } });
  if (!conn) throw new Error("Falta conexión Google (GoogleAdsConnection). Necesaria para GA4.");
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

async function resolvePropertyId(opts: {
  workspaceId: string;
  propertyId?: string | null;
  clientId?: string | null;
}): Promise<string> {
  if (opts.propertyId) return String(opts.propertyId).replace(/^properties\//, "");
  if (opts.clientId) {
    const c = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId }
    });
    const pid = (c as any)?.settings?.ga4PropertyId;
    if (pid) return String(pid);
  }
  const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId } });
  const wsPid = (ws?.settings as any)?.integrations?.ga4?.defaultPropertyId;
  if (wsPid) return String(wsPid);
  throw new Error(
    "GA4 propertyId no encontrado. Pásalo en la tool, o configúralo en Client.settings.ga4PropertyId / Workspace.settings.integrations.ga4.defaultPropertyId."
  );
}

type Ga4DateRange = { startDate: string; endDate: string };

function presetToDateRange(preset: string): Ga4DateRange {
  // GA4 acepta "today", "yesterday", "NdaysAgo".
  const m = /^last_(\d+)_days$/i.exec(preset);
  if (m) return { startDate: `${m[1]}daysAgo`, endDate: "yesterday" };
  if (preset === "this_month") return { startDate: "2024-01-01", endDate: "today" };
  return { startDate: "30daysAgo", endDate: "yesterday" };
}

export async function ga4GetReport(opts: {
  workspaceId: string;
  propertyId?: string;
  clientId?: string;
  datePreset?: string; // "last_7_days" | "last_30_days" | "last_90_days"
  since?: string; // YYYY-MM-DD
  until?: string;
  metrics?: string[]; // ej. ["sessions","totalUsers","conversions"]
  dimensions?: string[]; // ej. ["country","sessionSourceMedium"]
  limit?: number;
}) {
  const propertyId = await resolvePropertyId({
    workspaceId: opts.workspaceId,
    propertyId: opts.propertyId,
    clientId: opts.clientId
  });
  const token = await getAccessToken(opts.workspaceId);
  const dateRange: Ga4DateRange =
    opts.since && opts.until
      ? { startDate: opts.since, endDate: opts.until }
      : presetToDateRange(opts.datePreset ?? "last_30_days");
  const metrics = (opts.metrics ?? ["sessions", "totalUsers", "conversions", "engagementRate"]).map(
    (name) => ({ name })
  );
  const dimensions = (opts.dimensions ?? []).map((name) => ({ name }));
  const body: any = {
    dateRanges: [dateRange],
    metrics,
    dimensions,
    limit: String(opts.limit ?? 50)
  };
  const r = await fetch(`${BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`GA4 ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const dimHeaders = (data.dimensionHeaders ?? []).map((h: any) => h.name);
  const metricHeaders = (data.metricHeaders ?? []).map((h: any) => h.name);
  const rows = (data.rows ?? []).map((row: any) => {
    const out: Record<string, any> = {};
    (row.dimensionValues ?? []).forEach((v: any, i: number) => {
      out[dimHeaders[i] ?? `dim${i}`] = v.value;
    });
    (row.metricValues ?? []).forEach((v: any, i: number) => {
      const n = Number(v.value);
      out[metricHeaders[i] ?? `m${i}`] = Number.isFinite(n) ? n : v.value;
    });
    return out;
  });
  return {
    propertyId,
    dateRange,
    metrics: metricHeaders,
    dimensions: dimHeaders,
    rowCount: rows.length,
    rows,
    totals: (data.totals ?? []).map((t: any) =>
      Object.fromEntries(
        (t.metricValues ?? []).map((v: any, i: number) => [
          metricHeaders[i] ?? `m${i}`,
          Number(v.value)
        ])
      )
    )
  };
}
