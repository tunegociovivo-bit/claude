/**
 * POST /api/v1/admin/subvenciones/external
 * Ingesta de convocatorias desde CUALQUIER fuente externa vía Make (BOJA,
 * Cámaras, fondos EU, scrapers…). Make envía un array y se vuelca al mismo
 * catálogo con su `fuente`. Autenticado con API key / sesión admin (withApi).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { upsertConvocatorias, type RawConvocatoria } from "@/lib/subvenciones/bdns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const item = z.object({
  id: z.string().min(1).max(200),
  titulo: z.string().min(1).max(500),
  organo: z.string().max(300).nullable().optional(),
  finalidad: z.string().max(2000).nullable().optional(),
  beneficiarios: z.string().max(500).nullable().optional(),
  sectores: z.string().max(500).nullable().optional(),
  regiones: z.string().max(300).nullable().optional(),
  importeTotal: z.number().nullable().optional(),
  fechaInicio: z.string().nullable().optional(),
  fechaFin: z.string().nullable().optional(),
  urlBases: z.string().max(500).nullable().optional()
});
const schema = z.object({
  fuente: z.string().min(2).max(40).default("externa"),
  convocatorias: z.array(item).min(1).max(500)
});

const d = (s?: string | null) => { if (!s) return null; const x = new Date(s); return isNaN(x.getTime()) ? null : x; };

export const POST = withApi({ scope: "*", rate: "admin" }, async (req) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const fuente = parsed.data.fuente.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || "externa";
  const list: RawConvocatoria[] = parsed.data.convocatorias.map((c) => ({
    id: `${fuente}:${c.id}`.slice(0, 190),
    titulo: c.titulo,
    organo: c.organo ?? null,
    finalidad: c.finalidad ?? null,
    beneficiarios: c.beneficiarios ?? null,
    sectores: c.sectores ?? null,
    regiones: c.regiones ?? null,
    importeTotal: c.importeTotal ?? null,
    fechaInicio: d(c.fechaInicio),
    fechaFin: d(c.fechaFin),
    urlBases: c.urlBases ?? null,
    raw: { source: fuente, ...c }
  }));
  const upserted = await upsertConvocatorias(list, fuente);
  return NextResponse.json({ ok: true, fuente, recibidas: list.length, upserted });
});
