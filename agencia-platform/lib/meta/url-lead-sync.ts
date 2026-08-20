import { createHash, randomUUID } from "crypto";
import { isIP } from "net";
import { lookup } from "dns/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { parseFile, tabularToObjects } from "@/lib/import/parse";
import { decryptSecret } from "@/lib/ai/crypto";
import { refreshUserAccessToken } from "@/lib/integrations/google-drive";

export type UrlLeadSource = {
  id: string;
  url: string;
  label: string;
  intervalMinutes: 60 | 360 | 720 | 1440;
  enabled: boolean;
  campaignId: string;
  campaignName: string;
  lastSyncAt?: string;
  nextSyncAt?: string;
  lastError?: string | null;
  lastImported?: number;
  totalImported?: number;
  seenHashes?: string[];
};

const MAX_BYTES = 10 * 1024 * 1024;
const SHEET_HEADER_ROWS = 20;
const SHEET_RECENT_ROWS = 500;
const SHEET_MAX_COLUMNS = 80;
// Keep one structured AI response comfortably below the provider output limit.
// A pending backlog is drained by the automatic five-minute follow-up runs.
const MAX_FRESH_ROWS_PER_SYNC = 12;
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];
const DOCUMENT_HOSTS = ["docs.google.com", "drive.google.com", "googleapis.com", "googleusercontent.com", "dropbox.com", "dropboxusercontent.com", "1drv.ms", "onedrive.live.com", "sharepoint.com"];

function isDocumentHost(host: string) {
  return DOCUMENT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return PRIVATE_V4.some((pattern) => pattern.test(address));
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new Error("La fuente debe usar HTTPS.");
  if (url.username || url.password) throw new Error("La URL no puede incluir credenciales.");
  const host = url.hostname.toLowerCase();
  if (!isDocumentHost(host)) throw new Error("Por seguridad, usa un enlace público de Google Drive/Sheets, Dropbox, OneDrive o SharePoint.");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("La URL no es pública.");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("La URL apunta a una red privada y ha sido bloqueada.");
}

export function normalizeLeadSourceUrl(raw: string): string {
  const url = new URL(raw.trim());
  const sheet = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && sheet) {
    const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid");
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=xlsx${gid ? `&gid=${gid}` : ""}`;
  }
  const doc = url.pathname.match(/^\/document\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`;
  return url.toString();
}

function googleFile(rawUrl: string): { id: string; kind: "sheet" | "doc"; gid?: string } | null {
  const url = new URL(rawUrl);
  const sheet = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && sheet) return { id: sheet[1], kind: "sheet", gid: url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? undefined };
  const doc = url.pathname.match(/^\/document\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && doc) return { id: doc[1], kind: "doc" };
  return null;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sheetColumnName(columnCount: number) {
  let value = Math.max(1, Math.min(SHEET_MAX_COLUMNS, columnCount));
  let result = "";
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function privateSheetRanges(title: string, rowCount: number, columnCount: number) {
  const quotedTitle = `'${title.replace(/'/g, "''")}'`;
  const lastColumn = sheetColumnName(columnCount);
  const lastRow = Math.max(1, rowCount);
  if (lastRow <= SHEET_HEADER_ROWS + SHEET_RECENT_ROWS) return [`${quotedTitle}!A1:${lastColumn}${lastRow}`];
  return [
    `${quotedTitle}!A1:${lastColumn}${SHEET_HEADER_ROWS}`,
    `${quotedTitle}!A${lastRow - SHEET_RECENT_ROWS + 1}:${lastColumn}${lastRow}`
  ];
}

export function leadClassificationBatches<T>(rows: T[]) {
  const batches: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += MAX_FRESH_ROWS_PER_SYNC) {
    batches.push(rows.slice(offset, offset + MAX_FRESH_ROWS_PER_SYNC));
  }
  return batches;
}

async function fetchPrivateSheet(file: { id: string; gid?: string }, accessToken: string, rawUrl: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}?fields=sheets.properties`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!metaResponse.ok) throw new Error(`Google Sheets respondió HTTP ${metaResponse.status}. Comprueba que tunegociovivo@gmail.com tenga acceso al documento.`);
  const meta = await metaResponse.json();
  const sheets = Array.isArray(meta.sheets) ? meta.sheets : [];
  const selected = sheets.find((item: any) => String(item?.properties?.sheetId) === String(file.gid)) ?? sheets[0];
  const title = selected?.properties?.title;
  if (!title) throw new Error("Google Sheets no devolvió ninguna pestaña legible.");
  const rowCount = Number(selected?.properties?.gridProperties?.rowCount) || 1;
  const columnCount = Number(selected?.properties?.gridProperties?.columnCount) || SHEET_MAX_COLUMNS;
  const values: unknown[][] = [];
  for (const range of privateSheetRanges(String(title), rowCount, columnCount)) {
    const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, { headers, signal: AbortSignal.timeout(90_000) });
    if (!valuesResponse.ok) throw new Error(`Google Sheets respondió HTTP ${valuesResponse.status}. Comprueba que tunegociovivo@gmail.com tenga acceso de lectura.`);
    const data = await valuesResponse.json();
    if (Array.isArray(data.values)) values.push(...data.values);
  }
  const buffer = Buffer.from(values.map((row) => row.map(csvCell).join(",")).join("\n"), "utf8");
  if (buffer.byteLength > MAX_BYTES) throw new Error("Las 500 filas más recientes superan el límite de 10 MB. Reduce el número de columnas o el contenido de las celdas.");
  return { buffer, mime: "text/csv", finalUrl: new URL(rawUrl) };
}

async function leadDocumentsAccessToken(workspaceId: string): Promise<string | null> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const config = (workspace?.settings as any)?.integrations?.googleLeadDocuments;
  if (!config?.refreshTokenEncrypted) return null;
  const refreshToken = decryptSecret(config.refreshTokenEncrypted);
  return refreshToken ? refreshUserAccessToken(refreshToken) : null;
}

async function fetchPublicDocument(rawUrl: string, workspaceId: string) {
  const privateGoogleFile = googleFile(rawUrl);
  const accessToken = privateGoogleFile ? await leadDocumentsAccessToken(workspaceId) : null;
  if (privateGoogleFile?.kind === "sheet" && accessToken) return fetchPrivateSheet(privateGoogleFile, accessToken, rawUrl);
  let current = new URL(normalizeLeadSourceUrl(rawUrl));
  if (privateGoogleFile && accessToken) {
    const mimeType = privateGoogleFile.kind === "sheet" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain";
    current = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(privateGoogleFile.id)}/export`);
    current.searchParams.set("mimeType", mimeType);
  }
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHttps(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), accessToken ? 90_000 : 25_000);
    try {
      const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "NegocioVivo-Hub/1.0", ...(accessToken && current.hostname === "www.googleapis.com" ? { Authorization: `Bearer ${accessToken}` } : {}) } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("La fuente redirige sin indicar destino.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`El documento respondió HTTP ${response.status}. ${privateGoogleFile && !accessToken ? "Conecta tunegociovivo@gmail.com para acceder a documentos privados." : "Comprueba que la cuenta conectada tenga acceso de lectura."}`);
      const announced = Number(response.headers.get("content-length") ?? 0);
      if (announced > MAX_BYTES) throw new Error("El documento supera el límite de 10 MB.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("El documento no devolvió contenido.");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error("El documento supera el límite de 10 MB."); }
        chunks.push(value);
      }
      return { buffer: Buffer.concat(chunks.map((item) => Buffer.from(item))), mime: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream", finalUrl: current };
    } finally { clearTimeout(timeout); }
  }
  throw new Error("La fuente contiene demasiadas redirecciones.");
}

function filenameFor(url: URL, mime: string) {
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "fuente.xlsx";
  if (mime.includes("pdf")) return "fuente.pdf";
  if (mime.includes("csv")) return "fuente.csv";
  if (mime.startsWith("text/")) return "fuente.csv";
  const name = decodeURIComponent(url.pathname.split("/").pop() || "fuente.csv");
  return /\.(csv|xlsx?|pdf)$/i.test(name) ? name : "fuente.csv";
}

function rowHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32); }

function readSources(stages: unknown): UrlLeadSource[] {
  if (!stages || typeof stages !== "object" || Array.isArray(stages)) return [];
  const sources = (stages as any).urlLeadSources;
  return Array.isArray(sources) ? sources.filter((item) => item && typeof item.url === "string") : [];
}

export function getUrlLeadSources(stages: unknown, campaignId?: string) {
  const sources = readSources(stages);
  return campaignId ? sources.filter((item) => item.campaignId === campaignId) : sources;
}

export async function saveUrlLeadSource(opts: { workspaceId: string; adAccountId: string; accountName: string; campaignId: string; campaignName: string; url: string; label?: string; intervalMinutes: UrlLeadSource["intervalMinutes"]; enabled: boolean; sourceId?: string }) {
  const normalized = normalizeLeadSourceUrl(opts.url);
  await assertPublicHttps(new URL(normalized));
  const profile = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId } } });
  const stages = profile?.commercialStages && typeof profile.commercialStages === "object" && !Array.isArray(profile.commercialStages) ? profile.commercialStages as Record<string, unknown> : {};
  const sources = readSources(stages); const now = new Date(); const id = opts.sourceId ?? randomUUID();
  const previous = sources.find((item) => item.id === id);
  const source: UrlLeadSource = { ...previous, id, url: opts.url.trim(), label: opts.label?.trim() || new URL(opts.url).hostname, intervalMinutes: opts.intervalMinutes, enabled: opts.enabled, campaignId: opts.campaignId, campaignName: opts.campaignName, nextSyncAt: now.toISOString(), seenHashes: previous?.url === opts.url.trim() ? previous.seenHashes ?? [] : [], totalImported: previous?.url === opts.url.trim() ? previous.totalImported ?? 0 : 0 };
  const next = [...sources.filter((item) => item.id !== id), source];
  const commercialStages = { ...stages, urlLeadSources: next } as Prisma.InputJsonValue;
  await prisma.metaClientProfile.upsert({ where: { workspaceId_adAccountId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId } }, create: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, displayName: opts.accountName, commercialStages }, update: { commercialStages } });
  return source;
}

export async function deleteUrlLeadSource(workspaceId: string, adAccountId: string, sourceId: string) {
  const profile = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId, adAccountId } } });
  if (!profile) return;
  const stages = profile.commercialStages && typeof profile.commercialStages === "object" && !Array.isArray(profile.commercialStages) ? profile.commercialStages as Record<string, unknown> : {};
  await prisma.metaClientProfile.update({ where: { id: profile.id }, data: { commercialStages: { ...stages, urlLeadSources: readSources(stages).filter((item) => item.id !== sourceId) } as Prisma.InputJsonValue } });
}

type AiLead = { rowHash: string; contactName: string | null; email: string | null; phone: string | null; occurredAt: string | null; isQualified: boolean };

export async function syncUrlLeadSource(opts: { workspaceId: string; adAccountId: string; sourceId: string; force?: boolean }) {
  const profile = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId } } });
  if (!profile) throw new Error("La cuenta no tiene perfil de atribución.");
  const stages = profile.commercialStages && typeof profile.commercialStages === "object" && !Array.isArray(profile.commercialStages) ? profile.commercialStages as Record<string, unknown> : {};
  const sources = readSources(stages); const source = sources.find((item) => item.id === opts.sourceId);
  if (!source) throw new Error("Fuente no encontrada.");
  if (!source.enabled && !opts.force) return { skipped: true, imported: 0 };
  if (!opts.force && source.nextSyncAt && Date.parse(source.nextSyncAt) > Date.now()) return { skipped: true, imported: 0 };
  try {
    const downloaded = await fetchPublicDocument(source.url, opts.workspaceId);
    const parsed = await parseFile(downloaded.buffer, filenameFor(downloaded.finalUrl, downloaded.mime), downloaded.mime);
    const rows: unknown[] = parsed.kind === "tabular" ? tabularToObjects(parsed.data) : parsed.text.split(/\n{2,}/).map((text) => ({ text })).filter((item) => item.text.trim());
    const seen = new Set(source.seenHashes ?? []);
    // Una sola llamada de IA por ejecución evita agotar el tiempo máximo de la
    // petición. Las siguientes revisiones continuarán con las filas pendientes.
    const unseenRows = rows.map((row) => ({ row, hash: rowHash(row) })).filter((item) => !seen.has(item.hash));
    const fresh = unseenRows.slice(-MAX_FRESH_ROWS_PER_SYNC);
    const hasBacklog = unseenRows.length > fresh.length;
    let extracted: AiLead[] = [];
    if (fresh.length) {
      const notes = (stages as any)?.campaignNotes?.[source.campaignId]?.qualificationNotes ?? "";
      for (const batch of leadClassificationBatches(fresh)) {
        const result = await completeJson<{ leads: AiLead[] }>({ workspaceId: opts.workspaceId, system: "Extrae leads reales de filas nuevas de un documento comercial. No inventes datos. Devuelve una entrada por fila que contenga un posible lead; conserva exactamente rowHash. isQualified solo puede ser true cuando la fila cumple claramente las indicaciones. Fechas en ISO o null.", user: JSON.stringify({ campaign: source.campaignName, qualificationNotes: notes, rows: batch }), schema: { type: "object", properties: { leads: { type: "array", items: { type: "object", properties: { rowHash: { type: "string" }, contactName: { type: ["string", "null"] }, email: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, occurredAt: { type: ["string", "null"] }, isQualified: { type: "boolean" } }, required: ["rowHash", "contactName", "email", "phone", "occurredAt", "isQualified"], additionalProperties: false } } }, required: ["leads"], additionalProperties: false }, maxTokens: 3000 });
        const allowed = new Set(batch.map((item) => item.hash));
        extracted.push(...(result.leads ?? []).filter((lead) => allowed.has(lead.rowHash)));
      }
    }
    let imported = 0;
    for (const lead of extracted) {
      const timestamp = lead.occurredAt && !Number.isNaN(Date.parse(lead.occurredAt)) ? new Date(lead.occurredAt) : new Date();
      const externalLeadId = `url:${source.id}:${lead.rowHash}`;
      await prisma.metaLeadAttribution.upsert({ where: { workspaceId_adAccountId_externalLeadId: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId } }, create: { workspaceId: opts.workspaceId, adAccountId: opts.adAccountId, externalLeadId, source: "url_document", campaignId: source.campaignId, campaignName: source.campaignName, contactName: lead.contactName, email: lead.email, phone: lead.phone, status: "new", occurredAt: timestamp, metadata: { sourceId: source.id, sourceUrl: source.url, rowHash: lead.rowHash, aiQualifiedSuggestion: lead.isQualified } }, update: { contactName: lead.contactName, email: lead.email, phone: lead.phone, campaignId: source.campaignId, campaignName: source.campaignName } });
      imported++;
    }
    const now = new Date(); const updated: UrlLeadSource = { ...source, lastSyncAt: now.toISOString(), nextSyncAt: new Date(now.getTime() + (hasBacklog ? 5 : source.intervalMinutes) * 60_000).toISOString(), lastError: null, lastImported: imported, totalImported: (source.totalImported ?? 0) + imported, seenHashes: [...(source.seenHashes ?? []), ...fresh.map((item) => item.hash)].slice(-5000) };
    await prisma.metaClientProfile.update({ where: { id: profile.id }, data: { commercialStages: { ...stages, urlLeadSources: sources.map((item) => item.id === source.id ? updated : item) } as Prisma.InputJsonValue } });
    return { skipped: false, imported, rowsRead: rows.length, newRows: fresh.length, source: updated };
  } catch (error: any) {
    const now = new Date(); const updated = { ...source, lastSyncAt: now.toISOString(), nextSyncAt: new Date(now.getTime() + source.intervalMinutes * 60_000).toISOString(), lastError: String(error?.message ?? error).slice(0, 500), lastImported: 0 };
    await prisma.metaClientProfile.update({ where: { id: profile.id }, data: { commercialStages: { ...stages, urlLeadSources: sources.map((item) => item.id === source.id ? updated : item) } as Prisma.InputJsonValue } });
    throw error;
  }
}
