import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { pickHeaderRow, norm, normTaxId, normEmail, nameTokens, nameSimilarity } from "./shared";
import { tabularToText, type ParsedFile, type Tabular } from "./parse";

export type ClientInput = {
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  fiscalAddress?: string;
  postalCode?: string;
  city?: string;
  province?: string;
  industry?: string;
  contactName?: string;
  mrr?: number;
  notes?: string;
};

export type ClientPlanItem = {
  input: ClientInput;
  action: "create" | "merge" | "noop" | "skip";
  matchId?: string;
  matchName?: string;
  matchVia?: "taxId" | "email" | "name" | "fuzzy";
  fillFields: string[];
  reason?: string;
};

const ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "cliente", "empresa", "nombre comercial", "razon comercial"],
  legalName: ["razon social", "razonsocial", "legal name", "denominacion social", "denominacion"],
  taxId: ["nif", "cif", "dni", "nif cif", "vat", "tax id", "identificacion fiscal", "nif/cif"],
  email: ["email", "correo", "e-mail", "mail", "correo electronico"],
  phone: ["telefono", "tel", "phone", "movil", "celular", "tlf", "telefono movil"],
  fiscalAddress: ["direccion", "domicilio", "address", "direccion fiscal", "calle"],
  postalCode: ["cp", "codigo postal", "postal", "zip", "codigopostal", "c.p."],
  city: ["ciudad", "poblacion", "localidad", "municipio", "city"],
  province: ["provincia", "province", "estado"],
  industry: ["sector", "industria", "actividad", "industry", "rubro"],
  contactName: ["contacto", "persona de contacto", "contact", "contact name", "responsable"],
  mrr: ["mrr", "cuota", "cuota mensual", "importe mensual", "mensualidad"],
  notes: ["notas", "observaciones", "notes", "comentarios", "nota"]
};

// Campos que se pueden rellenar al hacer merge (todos menos `name`).
export const FILLABLE: (keyof ClientInput)[] = [
  "legalName",
  "taxId",
  "email",
  "phone",
  "fiscalAddress",
  "postalCode",
  "city",
  "province",
  "industry",
  "contactName",
  "mrr",
  "notes"
];

function rowToClient(row: string[], cols: Record<string, number>): ClientInput | null {
  const get = (field: string): string => {
    const idx = cols[field];
    if (idx === undefined) return "";
    return (row[idx] ?? "").trim();
  };
  const name = get("name");
  if (!name) return null;
  const mrrRaw = get("mrr");
  const input: ClientInput = { name };
  const map: [keyof ClientInput, string][] = [
    ["legalName", get("legalName")],
    ["taxId", get("taxId")],
    ["email", get("email")],
    ["phone", get("phone")],
    ["fiscalAddress", get("fiscalAddress")],
    ["postalCode", get("postalCode")],
    ["city", get("city")],
    ["province", get("province")],
    ["industry", get("industry")],
    ["contactName", get("contactName")]
  ];
  for (const [k, v] of map) if (v) (input as any)[k] = v;
  if (mrrRaw) {
    const n = Number(mrrRaw.replace(/[€\s]/g, "").replace(",", "."));
    if (!isNaN(n)) input.mrr = Math.round(n);
  }
  const notes = get("notes");
  if (notes) input.notes = notes;
  return input;
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    clients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          legalName: { type: "string" },
          taxId: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          fiscalAddress: { type: "string" },
          postalCode: { type: "string" },
          city: { type: "string" },
          province: { type: "string" },
          industry: { type: "string" },
          contactName: { type: "string" }
        },
        required: ["name"]
      }
    }
  },
  required: ["clients"]
};

async function aiExtractClients(workspaceId: string, text: string): Promise<ClientInput[]> {
  const res = await completeJson<{ clients: ClientInput[] }>({
    workspaceId,
    system:
      "Eres un extractor de datos. Te paso el texto de un PDF que contiene un LISTADO de clientes/empresas. " +
      "Devuelve un array con un objeto por cliente. Extrae solo lo que aparezca explícitamente; no inventes. " +
      "Si un campo no aparece, omítelo. 'name' es el nombre comercial del cliente y es obligatorio.",
    user: text.slice(0, 100_000),
    schema: AI_SCHEMA,
    maxTokens: 8192,
    feature: "import-clients-pdf"
  } as any);
  return (res.clients ?? []).filter((c) => c.name && c.name.trim());
}

/**
 * Convierte un archivo parseado en una lista de ClientInput. Para tablas
 * (CSV/Excel) detecta las columnas (exacto, sin coste); si no las reconoce,
 * lo interpreta la IA. Para PDF siempre IA.
 */
export async function extractClientInputs(workspaceId: string, parsed: ParsedFile): Promise<ClientInput[]> {
  if (parsed.kind === "pdf") return aiExtractClients(workspaceId, parsed.text);

  const viaCols = extractClientsByColumns(parsed.data);
  if (viaCols && viaCols.length) return viaCols;

  let aiErr = "";
  try {
    const rows = await aiExtractClients(workspaceId, tabularToText(parsed.data));
    if (rows.length) return rows;
  } catch (e: any) {
    aiErr = String(e?.message ?? e);
  }

  const found = parsed.data.matrix?.[0]?.filter(Boolean).join(", ") || "ninguna";
  throw new Error(
    `No he podido leer los clientes del archivo. No encuentro la columna de nombre. ` +
      `Columnas detectadas: ${found}. ` +
      (aiErr
        ? `La IA tampoco pudo: ${aiErr}`
        : `Renombra la columna del nombre a "Nombre" (o "Cliente"), o configura la IA en /admin/ai.`)
  );
}

/** Detección por cabeceras (sin IA). null si no encuentra columna de nombre. */
function extractClientsByColumns(t: Tabular): ClientInput[] | null {
  if (!t.matrix?.length) return null;
  const picked = pickHeaderRow(t.matrix, ALIASES, ["name"]);
  if (!picked) return null;
  const dataRows = t.matrix.slice(picked.headerIdx + 1).filter((r) => r.some((c) => c !== ""));
  return dataRows.map((r) => rowToClient(r, picked.cols)).filter((c): c is ClientInput => !!c);
}

/** ¿Coinciden dos inputs (mismo cliente) por NIF, email o nombre aproximado? */
function sameClient(
  a: { tax: string; email: string; tokens: string[] },
  b: { tax: string; email: string; tokens: string[] }
): boolean {
  if (a.tax && b.tax) return a.tax === b.tax;
  if (a.email && b.email && a.email === b.email) return true;
  if (a.tokens.length && b.tokens.length) {
    const score = nameSimilarity(a.tokens, b.tokens);
    const sharedLong = a.tokens.some((t) => t.length >= 4 && b.tokens.includes(t));
    if (score >= 0.6 && sharedLong) return true;
  }
  return false;
}

/** Rellena en `base` los campos vacíos con los de `extra` (no sobrescribe). */
function fillEmpty(base: ClientInput, extra: ClientInput): void {
  for (const f of FILLABLE) {
    if (isEmpty((base as any)[f]) && !isEmpty((extra as any)[f])) {
      (base as any)[f] = (extra as any)[f];
    }
  }
}

/**
 * Fusiona filas PARECIDAS dentro del mismo import (p. ej. "Mudanzas Reva" y
 * "Mudanzas Reva S.L."): se combinan en un único cliente sumando los datos
 * de unas y otras, para que la ficha quede lo más completa posible.
 */
export function consolidateClientInputs(inputs: ClientInput[]): ClientInput[] {
  const groups: { rep: ClientInput; tax: string; email: string; tokens: string[] }[] = [];
  for (const inp of inputs) {
    if (!inp.name?.trim()) {
      groups.push({ rep: { ...inp }, tax: "", email: "", tokens: [] });
      continue;
    }
    const key = { tax: normTaxId(inp.taxId), email: normEmail(inp.email), tokens: nameTokens(inp.name) };
    const g = groups.find((g) => g.tokens.length >= 0 && sameClient(g, key));
    if (g) {
      fillEmpty(g.rep, inp);
      if (!g.tax && key.tax) g.tax = key.tax;
      if (!g.email && key.email) g.email = key.email;
      if (g.tokens.length === 0) g.tokens = key.tokens;
    } else {
      groups.push({ rep: { ...inp }, ...key });
    }
  }
  return groups.map((g) => g.rep);
}

function isEmpty(v: any): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Construye el plan de importación: empareja cada cliente del archivo con
 * los existentes (por NIF y, si no, por nombre) y calcula qué campos
 * AÑADIR (solo los que el cliente existente no tenga). Nunca sobrescribe.
 */
export async function buildClientPlan(workspaceId: string, rawInputs: ClientInput[]): Promise<ClientPlanItem[]> {
  // Fusiona filas parecidas del propio archivo antes de cotejar con la BD.
  const inputs = consolidateClientInputs(rawInputs);
  const existing = await prisma.client.findMany({
    where: { workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      legalName: true,
      taxId: true,
      email: true,
      phone: true,
      fiscalAddress: true,
      postalCode: true,
      city: true,
      province: true,
      industry: true,
      contactName: true,
      mrr: true,
      notes: true
    }
  });
  type Row = (typeof existing)[number];
  const byTax = new Map<string, Row>();
  const byEmail = new Map<string, Row>();
  const byName = new Map<string, Row>();
  const tokenized = existing.map((c) => ({ row: c, tokens: nameTokens(c.name) }));
  for (const c of existing) {
    const t = normTaxId(c.taxId);
    if (t) byTax.set(t, c);
    const e = normEmail(c.email);
    if (e) byEmail.set(e, c);
    byName.set(norm(c.name), c);
  }

  const items: ClientPlanItem[] = [];
  for (const input of inputs) {
    if (!input.name?.trim()) {
      items.push({ input, action: "skip", fillFields: [], reason: "Sin nombre" });
      continue;
    }
    const tax = normTaxId(input.taxId);
    const email = normEmail(input.email);
    let match: Row | null = (tax && byTax.get(tax)) || null;
    let via: ClientPlanItem["matchVia"] = match ? "taxId" : undefined;
    if (!match && email) {
      match = byEmail.get(email) ?? null;
      if (match) via = "email";
    }
    if (!match) {
      match = byName.get(norm(input.name)) ?? null;
      if (match) via = "name";
    }
    // Coincidencia aproximada por nombre (sin forma jurídica, tolerante).
    if (!match) {
      const inTokens = nameTokens(input.name);
      let best: { row: Row; score: number } | null = null;
      for (const cand of tokenized) {
        const score = nameSimilarity(inTokens, cand.tokens);
        // Exige solapamiento alto y al menos un token largo en común.
        const sharedLong = inTokens.some((t) => t.length >= 4 && cand.tokens.includes(t));
        if (score >= 0.6 && sharedLong && (!best || score > best.score)) {
          best = { row: cand.row, score };
        }
      }
      if (best) {
        match = best.row;
        via = "fuzzy";
      }
    }

    if (!match) {
      items.push({ input, action: "create", fillFields: [] });
      continue;
    }
    const fillFields: string[] = [];
    for (const f of FILLABLE) {
      const incoming = (input as any)[f];
      if (isEmpty(incoming)) continue;
      const current = (match as any)[f];
      const currentEmpty = f === "mrr" ? !current : isEmpty(current);
      if (currentEmpty) fillFields.push(f);
    }
    items.push({
      input,
      action: fillFields.length ? "merge" : "noop",
      matchId: match.id,
      matchName: match.name,
      matchVia: via,
      fillFields
    });
  }
  return items;
}

/** Aplica el plan: crea nuevos y rellena campos faltantes en existentes.
 *  Con onlyExisting=true NO crea clientes nuevos: solo completa los que ya
 *  existen (útil para "actualizar datos fiscales desde Holded"). */
export async function applyClientImport(
  workspaceId: string,
  inputs: ClientInput[],
  opts?: { onlyExisting?: boolean }
): Promise<{ created: number; merged: number; skipped: number }> {
  const plan = await buildClientPlan(workspaceId, inputs);
  let created = 0;
  let merged = 0;
  let skipped = 0;

  for (const item of plan) {
    if (item.action === "create" && opts?.onlyExisting) {
      skipped++;
    } else if (item.action === "create") {
      const { name, mrr, ...rest } = item.input;
      await prisma.client.create({
        data: {
          workspaceId,
          name,
          status: "ACTIVE",
          mrr: typeof mrr === "number" ? mrr : 0,
          ...rest
        } as any
      });
      created++;
    } else if (item.action === "merge" && item.matchId) {
      const data: any = {};
      for (const f of item.fillFields) data[f] = (item.input as any)[f];
      await prisma.client.update({ where: { id: item.matchId }, data });
      merged++;
    } else {
      skipped++;
    }
  }
  return { created, merged, skipped };
}
