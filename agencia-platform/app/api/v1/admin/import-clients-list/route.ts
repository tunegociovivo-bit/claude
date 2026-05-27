/**
 * POST /api/v1/admin/import-clients-list
 *
 * Importa el listado inicial de clientes (Google Sheets del usuario,
 * "Listado clientes 2026-05-17"). Idempotente: si un cliente con el
 * mismo nombre ya existe en BD (case-insensitive), se SALTA — no
 * sobrescribe nada.
 *
 * One-shot: el usuario lo lanza desde /admin pulsando "Importar
 * listado de clientes". Después puede desactivarse.
 *
 * Datos hardcodeados — vienen del Sheet a 2026-05-17. Si el sheet
 * cambia, regenerar este archivo manualmente.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

type Imp = {
  name: string;
  servicios: string[];
  status: "ACTIVE" | "PROSPECT";
  prioridad: "ALTA" | "NORMAL" | "BAJA";
  notes?: string;
};

// Mapeo del texto del Sheet → slugs de servicio canónicos.
const SERVICIO_MAP: Record<string, string> = {
  SEO: "seo_web",
  "GESTIÓN REDES": "gestion_redes",
  "GESTION REDES": "gestion_redes",
  SEM: "sem",
  "FICHA GMB": "gmb",
  GMB: "gmb",
  "CAMPAÑAS REDES": "campana_redes",
  "CAMPANAS REDES": "campana_redes",
  "DISEÑO WEB": "diseno_web",
  "DISENO WEB": "diseno_web",
  "COMERCIO ELECTRÓNICO": "comercio_electronico",
  "COMERCIO ELECTRONICO": "comercio_electronico",
  "MANTENIMIENTO WEB": "mantenimiento",
  MANTENIMIENTO: "mantenimiento",
  SERVIDOR: "servidor",
  DOMINIO: "dominio",
  "QR RESEÑAS RESTAURANTES": "resenas_qr",
  "RESEÑAS QR": "resenas_qr"
};

function parseServicios(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .map((s) => SERVICIO_MAP[s])
    .filter((s): s is string => Boolean(s));
}

// Lista hardcodeada del sheet (2026-05-17). 71 entradas, ISABEL MECA
// aparece 2 veces — la segunda se ignora por dedup case-insensitive.
const RAW: { name: string; servicios: string; cliente: "SI" | "NO"; prio: "ALTA" | "NORMAL" | "BAJA" | ""; nota?: string }[] = [
  { name: "AUTOMATIC CHOICE", servicios: "SEO, GESTIÓN REDES, SEM", cliente: "SI", prio: "" },
  { name: "AITZIBER YAGUE CORTAZAR", servicios: "SEO, FICHA GMB, GESTIÓN REDES, CAMPAÑAS REDES", cliente: "SI", prio: "ALTA" },
  { name: "ATELIER DENTAL", servicios: "SEO, GESTIÓN REDES", cliente: "SI", prio: "" },
  { name: "AQUAKING EMPRENDEDORES", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "AGENCIA DE VIAJES TRAVEL M&M", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "AQUAFIREDETECCION", servicios: "SEM", cliente: "SI", prio: "ALTA" },
  { name: "BARBERIA MAN,S WORLD SEVILLA TATTOO AND BARBER - MARIDO MYRIAM MASAJES", servicios: "FICHA GMB", cliente: "SI", prio: "" },
  { name: "BITASPAIN", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "BISHOP", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "CLINICA YESIM ALEMANIA", servicios: "FICHA GMB", cliente: "SI", prio: "" },
  { name: "CLINIOLMO", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "CLÍNICA CAPILAR MARCH", servicios: "SEO, GESTIÓN REDES, CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "CUATRO CAMINOS ABOGADOS", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "CELINA LIZ FOTOGRAFÍA", servicios: "SEO", cliente: "NO", prio: "" },
  { name: "CERRAJERO CADIZ CERRADURAS ANGEL", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "CERRAJERO MURCIA - DAVID", servicios: "FICHA GMB", cliente: "SI", prio: "" },
  { name: "CENTRO MÉDICO ESTÉTICO AYC", servicios: "SEO, FICHA GMB, GESTIÓN REDES, CAMPAÑAS REDES", cliente: "SI", prio: "ALTA" },
  { name: "DAVISA MICROPIGMENTACIÓN CAPILAR - VANESA", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "DUNNANUNCIATURA", servicios: "CAMPAÑAS REDES, SEM", cliente: "SI", prio: "ALTA" },
  { name: "DUNNAEPIFANÍA", servicios: "CAMPAÑAS REDES, SEM, DISEÑO WEB, COMERCIO ELECTRÓNICO", cliente: "SI", prio: "ALTA" },
  { name: "ESTORES MÁLAGA", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "EMPRESA SOLVENTE", servicios: "DISEÑO WEB", cliente: "SI", prio: "" },
  { name: "EUROSISTEMAS", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "ESAEM", servicios: "SEO, FICHA GMB, GESTIÓN REDES, CAMPAÑAS REDES, SEM, COMERCIO ELECTRÓNICO", cliente: "SI", prio: "ALTA" },
  { name: "EROSKI", servicios: "SEO, GESTIÓN REDES, CAMPAÑAS REDES, SEM, SERVIDOR", cliente: "SI", prio: "ALTA" },
  { name: "EL POLLO CAMPEÓN", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "INTEGRAL MOTO SERVIDOR", servicios: "SERVIDOR", cliente: "SI", prio: "" },
  { name: "IMPRECARD", servicios: "", cliente: "NO", prio: "" },
  { name: "ISABEL MECA", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "I HOST YOU", servicios: "SEO, SERVIDOR", cliente: "NO", prio: "" },
  { name: "LA MARISCÁ", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "LASEGUR", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "LEGION RACE", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "MUDANZAS REVA", servicios: "SEO, FICHA GMB, GESTIÓN REDES, SEM", cliente: "SI", prio: "ALTA" },
  { name: "MUDANZAS LORENA", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "MUDANZAS PLATA", servicios: "SEO, FICHA GMB, SEM", cliente: "SI", prio: "ALTA" },
  { name: "MUDANZAS JM", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "MUDANZAS LUJAN", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "MAR COSTA DEL SOL", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "MICROPIGMENTACIÓN CAPILAR LEIRE GARZO", servicios: "", cliente: "SI", prio: "", nota: "Leire deja de ser cliente a abril de 2026, seguimos con el KD de https://microcapilardonostia.com" },
  { name: "MASAJES CENTRO MILLENIUM (MÁLAGA - FUENGIROLA)", servicios: "FICHA GMB", cliente: "SI", prio: "ALTA" },
  { name: "MASAJES ARUKSA", servicios: "SEO, SEM, CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "MASAJES SECRET PLEASURE MASSAGE (TORNEO - LA BUHAIRA)", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "MASAJES KAIMO", servicios: "", cliente: "SI", prio: "" },
  { name: "MASAJES EROTICOS MADRID (DAVID) 1º FICHA", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "MASAJES EROTICOS MADRID (DAVID) 2º FICHA", servicios: "FICHA GMB", cliente: "SI", prio: "" },
  { name: "MASAJES EROTICOS MADRID (DAVID) 3º FICHA", servicios: "FICHA GMB", cliente: "SI", prio: "ALTA" },
  { name: "MASAJES EROTICOS ALICANTE (DAVID) 1º FICHA", servicios: "FICHA GMB", cliente: "SI", prio: "ALTA" },
  { name: "MAYPE COPIADORAS", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "MARÍN FLORISTAS", servicios: "MANTENIMIENTO WEB", cliente: "SI", prio: "BAJA" },
  { name: "LAURA MONGE", servicios: "SEO, FICHA GMB", cliente: "NO", prio: "BAJA" },
  { name: "LILIUMESTETICA - NAHIKARI", servicios: "SEO, CAMPAÑAS REDES", cliente: "NO", prio: "" },
  { name: "OSTEOPATA SEVILLA", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "OPTICAS EVISIÓN", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "OLD SKULLS CLOTHIN FIGHTER", servicios: "CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "OHCORDOBA", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "PAKELO", servicios: "SEO, GESTIÓN REDES, CAMPAÑAS REDES", cliente: "SI", prio: "" },
  { name: "PSICOFUNCIONALMENTE", servicios: "SERVIDOR", cliente: "SI", prio: "" },
  { name: "PLUS PROYECT", servicios: "", cliente: "NO", prio: "" },
  { name: "REFORMAS ORCE", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "RESTAURANTE LA FRAGATA", servicios: "QR RESEÑAS RESTAURANTES", cliente: "SI", prio: "" },
  { name: "RIGHT CASA", servicios: "SEO, FICHA GMB, SEM, COMERCIO ELECTRÓNICO", cliente: "SI", prio: "" },
  { name: "RUMBOSUR VIAJES", servicios: "SEO, FICHA GMB, CAMPAÑAS REDES", cliente: "NO", prio: "" },
  { name: "TAXI GRANDE MÁLAGA", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "TALLERES DOS HERMANAS SEVILLA", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "TANTRA USUAYA", servicios: "SEO, FICHA GMB", cliente: "SI", prio: "" },
  { name: "TRASTEROS MÁLAGA (REVA)", servicios: "SEO", cliente: "SI", prio: "ALTA" },
  { name: "TECNOIDENTIA", servicios: "SEO, SEM", cliente: "SI", prio: "" },
  { name: "TU PSICOLOGA ONLINE", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "2M2", servicios: "SEO", cliente: "SI", prio: "" },
  { name: "RS AVOCATS", servicios: "FICHA GMB", cliente: "SI", prio: "ALTA" }
];

function buildList(): Imp[] {
  const seen = new Set<string>();
  const out: Imp[] = [];
  for (const r of RAW) {
    const key = r.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: r.name.trim(),
      servicios: parseServicios(r.servicios),
      status: r.cliente === "SI" ? "ACTIVE" : "PROSPECT",
      prioridad: (r.prio || "NORMAL") as Imp["prioridad"],
      notes: r.nota
    });
  }
  return out;
}

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const list = buildList();
  // Pre-traer clientes ya existentes para dedup case-insensitive.
  const existing = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true }
  });
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

  const created: { name: string; id: string }[] = [];
  const skipped: string[] = [];
  for (const imp of list) {
    if (existingNames.has(imp.name.toLowerCase().trim())) {
      skipped.push(imp.name);
      continue;
    }
    const c = await prisma.client.create({
      data: {
        workspaceId: api.workspaceId,
        name: imp.name,
        status: imp.status,
        prioridad: imp.prioridad as any,
        servicios: imp.servicios as any,
        notes: imp.notes ?? null
      }
    });
    created.push({ name: c.name, id: c.id });
  }
  return NextResponse.json({
    total: list.length,
    created: created.length,
    skipped: skipped.length,
    createdItems: created.slice(0, 5),
    skippedItems: skipped.slice(0, 5)
  });
});
