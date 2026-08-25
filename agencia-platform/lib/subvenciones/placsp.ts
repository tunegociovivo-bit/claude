import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { RawConvocatoria, upsertConvocatorias } from "./bdns";
import { prisma } from "@/lib/db/prisma";

const PLACSP_BASE = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643";
const RELEVANT = /marketing|publicidad|comunicaci[oó]n\s+(?:institucional|corporativa|publicitaria|digital|social)|estrategia\s+de\s+comunicaci[oó]n|servicios?\s+de\s+comunicaci[oó]n|gabinete\s+de\s+prensa|dise[nñ]o\s+web|desarrollo\s+web|mantenimiento\s+web|redes\s+sociales|posicionamiento|\bseo\b|\bsem\b|campa[nñ]a\s+(?:publicitaria|de\s+publicidad|de\s+comunicaci[oó]n)|contenido[s]?\s+audiovisual|producci[oó]n\s+audiovisual|branding|imagen\s+corporativa/i;

function decodeXml(value: string): string {
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(xml: string, localName: string): string | null {
  const match = new RegExp(`<(?:(?:[\\w-]+):)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${localName}>`, "i").exec(xml);
  return match ? decodeXml(match[1]) || null : null;
}

function numberValue(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parsePlacspAtom(xml: string, now = new Date()): RawConvocatoria[] {
  const entries = xml.match(/<(?:[\w-]+:)?entry\b[\s\S]*?<\/(?:[\w-]+:)?entry>/gi) ?? [];
  const result: RawConvocatoria[] = [];
  for (const entry of entries) {
    const title = tag(entry, "title") ?? tag(entry, "ContractFolderID") ?? "Licitación pública";
    const summary = tag(entry, "Description") ?? tag(entry, "summary") ?? "";
    if (!RELEVANT.test(`${title} ${summary}`)) continue;
    const deadline = dateValue(tag(entry, "EndDateTime") ?? tag(entry, "EndDate"));
    if (deadline && deadline.getTime() < now.getTime()) continue;
    const rawId = tag(entry, "id") ?? tag(entry, "ContractFolderID") ?? `${title}:${deadline?.toISOString() ?? ""}`;
    const id = `placsp:${createHash("sha256").update(rawId).digest("hex").slice(0, 32)}`;
    const link = /<(?:[\w-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(entry)?.[1] ?? null;
    result.push({ id, titulo: title.slice(0, 500), organo: tag(entry, "Name")?.slice(0, 500) ?? null, finalidad: summary.slice(0, 1000) || null, beneficiarios: "Empresas y profesionales habilitados para contratar con el sector público", sectores: "Marketing, publicidad, comunicación y servicios digitales", regiones: tag(entry, "CountrySubentity") ?? tag(entry, "CityName") ?? "España", importeTotal: numberValue(tag(entry, "EstimatedOverallContractAmount") ?? tag(entry, "TaxExclusiveAmount") ?? tag(entry, "PayableAmount")), fechaInicio: dateValue(tag(entry, "updated") ?? tag(entry, "IssueDate")), fechaFin: deadline, urlBases: link ? decodeXml(link) : null, raw: { source: "placsp", sourceId: rawId } });
  }
  return result;
}

export async function ingestPlacspMarketing(date = new Date()): Promise<{ fetched: number; relevant: number; upserted: number }> {
  const yearMonth = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  // PLACSP genera un ZIP mensual voluminoso y su servidor público suele responder
  // con lentitud. Dejamos margen dentro del maxDuration=300 de la ruta.
  const response = await fetch(`${PLACSP_BASE}/licitacionesPerfilesContratanteCompleto3_${yearMonth}.zip`, { signal: AbortSignal.timeout(270_000) });
  if (!response.ok) throw new Error(`PLACSP ${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const decoder = new TextDecoder("utf-8");
  let fetched = 0;
  const relevant: RawConvocatoria[] = [];
  for (const [name, contents] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith(".atom")) continue;
    const xml = decoder.decode(contents);
    fetched += (xml.match(/<(?:[\w-]+:)?entry\b/gi) ?? []).length;
    relevant.push(...parsePlacspAtom(xml, date));
  }
  const unique = [...new Map(relevant.map((item) => [item.id, item])).values()];
  if (fetched > 0) await prisma.subvencionConvocatoria.updateMany({ where: { fuente: "placsp", abierta: true }, data: { abierta: false } });
  return { fetched, relevant: unique.length, upserted: await upsertConvocatorias(unique, "placsp") };
}
