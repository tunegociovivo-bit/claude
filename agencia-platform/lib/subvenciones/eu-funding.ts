import { createHash } from "node:crypto";
import { RawConvocatoria, upsertConvocatorias } from "./bdns";
import { prisma } from "@/lib/db/prisma";

const ENDPOINT = "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA";
const SEARCHES = ["digital transformation", "artificial intelligence", "marketing communication"];

function first(value: unknown): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item == null ? null : String(item);
}

function text(value: unknown): string | null {
  const raw = first(value);
  return raw ? raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : null;
}

function date(value: unknown): Date | null {
  const raw = first(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function searchEuFunding(search: string, query: string): Promise<any> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const form = new URLSearchParams({ query, pageSize: "100", pageNumber: "1", language: "en" });
    const response = await fetch(`${ENDPOINT}&text=${encodeURIComponent(search)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(45_000) });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (![404, 408, 429, 500, 502, 503, 504].includes(response.status)) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`EU Funding API ${lastStatus || "sin respuesta"} (${search})`);
}

export async function fetchEuFunding(now = new Date()): Promise<RawConvocatoria[]> {
  const query = JSON.stringify({ bool: { must: [{ terms: { type: ["1", "2", "8"] } }, { terms: { status: ["31094501", "31094502"] } }] } });
  const all: RawConvocatoria[] = [];
  const errors: string[] = [];
  let successfulSearches = 0;
  for (const search of SEARCHES) {
    let payload: any;
    try {
      payload = await searchEuFunding(search, query);
      successfulSearches++;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    for (const result of payload?.results ?? []) {
      const meta = result?.metadata ?? {};
      const deadline = date(meta.deadlineDate ?? meta.closingDate);
      if (!deadline || deadline.getTime() < now.getTime()) continue;
      const url = first(meta.url ?? meta.esST_URL) ?? result?.url ?? null;
      const rawId = first(meta.ccm2Id ?? meta.identifier) ?? result?.reference ?? url;
      if (!rawId) continue;
      const title = text(meta.callTitle ?? meta.title) ?? text(result.summary) ?? "Convocatoria europea";
      all.push({
        id: `fondos-eu:${createHash("sha256").update(String(rawId)).digest("hex").slice(0, 32)}`,
        titulo: title.slice(0, 500), organo: "Comisión Europea · Funding & Tenders Portal",
        finalidad: text(meta.description ?? result.content)?.slice(0, 1000) ?? null,
        beneficiarios: text(meta.conditions ?? meta.beneficiaryAdministration)?.slice(0, 1000) ?? "Empresas y organizaciones elegibles de la Unión Europea",
        sectores: "Digitalización, inteligencia artificial, marketing y comunicación", regiones: "Unión Europea",
        importeTotal: Number(first(meta.budget) ?? 0) || null, fechaInicio: date(meta.startDate), fechaFin: deadline,
        urlBases: url, raw: { source: "fondos-eu", reference: rawId }
      });
    }
  }
  if (successfulSearches === 0) throw new Error(errors.join(" · ") || "EU Funding API sin respuesta");
  return [...new Map(all.map((item) => [item.id, item])).values()];
}

export async function ingestEuFunding(): Promise<{ fetched: number; upserted: number; cached?: boolean; warning?: string }> {
  try {
    const rows = await fetchEuFunding();
    return { fetched: rows.length, upserted: await upsertConvocatorias(rows, "fondos-eu") };
  } catch (error) {
    const cached = await prisma.subvencionConvocatoria.count({ where: { fuente: "fondos-eu" } });
    if (cached > 0) return { fetched: cached, upserted: 0, cached: true, warning: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}
