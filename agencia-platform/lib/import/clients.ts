import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { detectColumns, norm, normTaxId } from "./shared";
import { tabularToObjects, type ParsedFile, type Tabular } from "./parse";

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

function rowToClient(obj: Record<string, string>, cols: Record<string, number>, headers: string[]): ClientInput | null {
  const get = (field: string): string => {
    const idx = cols[field];
    if (idx === undefined) return "";
    return (obj[headers[idx]] ?? "").trim();
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

/** Convierte un archivo parseado en una lista de ClientInput. */
export async function extractClientInputs(workspaceId: string, parsed: ParsedFile): Promise<ClientInput[]> {
  if (parsed.kind === "pdf") return aiExtractClients(workspaceId, parsed.text);
  const t: Tabular = parsed.data;
  const cols = detectColumns(t.headers, ALIASES);
  if (cols.name === undefined) {
    throw new Error(
      "No se ha encontrado la columna de nombre. Asegúrate de que el archivo tiene una cabecera tipo 'Nombre' o 'Cliente'."
    );
  }
  const objects = tabularToObjects(t);
  return objects.map((o) => rowToClient(o, cols, t.headers)).filter((c): c is ClientInput => !!c);
}

function isEmpty(v: any): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Construye el plan de importación: empareja cada cliente del archivo con
 * los existentes (por NIF y, si no, por nombre) y calcula qué campos
 * AÑADIR (solo los que el cliente existente no tenga). Nunca sobrescribe.
 */
export async function buildClientPlan(workspaceId: string, inputs: ClientInput[]): Promise<ClientPlanItem[]> {
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
  const byTax = new Map<string, (typeof existing)[number]>();
  const byName = new Map<string, (typeof existing)[number]>();
  for (const c of existing) {
    const t = normTaxId(c.taxId);
    if (t) byTax.set(t, c);
    byName.set(norm(c.name), c);
  }

  const items: ClientPlanItem[] = [];
  for (const input of inputs) {
    if (!input.name?.trim()) {
      items.push({ input, action: "skip", fillFields: [], reason: "Sin nombre" });
      continue;
    }
    const tax = normTaxId(input.taxId);
    const match = (tax && byTax.get(tax)) || byName.get(norm(input.name)) || null;
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
      fillFields
    });
  }
  return items;
}

/** Aplica el plan: crea nuevos y rellena campos faltantes en existentes. */
export async function applyClientImport(
  workspaceId: string,
  inputs: ClientInput[]
): Promise<{ created: number; merged: number; skipped: number }> {
  const plan = await buildClientPlan(workspaceId, inputs);
  let created = 0;
  let merged = 0;
  let skipped = 0;

  for (const item of plan) {
    if (item.action === "create") {
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
