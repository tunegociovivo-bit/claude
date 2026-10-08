/**
 * Nombre del negocio en los mensajes salientes + barrera anti "{{...}}".
 *
 * Problema que resuelve: plantillas (cadencia GMB, plantillas antiguas, textos
 * escritos a mano) usaban {{nombre}}, {{negocio}}, {{companyName}}… pero el
 * motor solo conocía {{nombre_negocio}}. El placeholder quedaba literal, la IA
 * de variaciones lo conservaba y el lead recibía "He visto que {{nombre}}…".
 *
 * Aquí se centraliza:
 *  - qué alias significan "nombre del negocio" (sin distinguir mayúsculas,
 *    tildes ni espacios: {{ Nombre del negocio }} también vale),
 *  - de dónde sale el nombre del lead (name → datos crudos de Google),
 *  - y la detección de cualquier placeholder que siga sin resolver, para que
 *    NUNCA llegue a un lead.
 *
 * Puro (sin BD): se usa al encolar, en la IA de variaciones y justo antes de
 * enviar.
 */

const BUSINESS_NAME_ALIASES = [
  "nombre_negocio",
  "nombre",
  "negocio",
  "nombre_del_negocio",
  "nombre_de_negocio",
  "nombre_empresa",
  "nombre_de_la_empresa",
  "empresa",
  "nombre_comercial",
  "nombre_ficha",
  "nombre_lead",
  "ficha",
  "companyname",
  "company_name",
  "company",
  "business",
  "business_name",
  "businessname",
  "lead_name",
  "name"
];

/** minúsculas, sin tildes, espacios/guiones → "_" */
export function normalizePlaceholderKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-.]+/g, "_");
}

const ALIAS_SET = new Set(BUSINESS_NAME_ALIASES.map(normalizePlaceholderKey));

export function isBusinessNameKey(raw: string): boolean {
  return ALIAS_SET.has(normalizePlaceholderKey(raw));
}

/** Limpia el nombre tal como viene de Google (espacios, comillas envolventes). */
export function cleanBusinessName(name: unknown): string {
  if (typeof name !== "string") return "";
  let out = name.replace(/\s+/g, " ").trim();
  out = out.replace(/^["'«“]+|["'»”]+$/g, "").trim();
  return out;
}

/**
 * Nombre del negocio del lead. Primero `lead.name`; si viniera vacío, se busca
 * en los datos crudos de Google Places (displayName.text, name, title).
 * Devuelve "" solo si de verdad no hay nombre en ningún sitio.
 */
export function resolveBusinessName(lead: { name?: string | null; rawData?: unknown } | null | undefined): string {
  if (!lead) return "";
  const direct = cleanBusinessName(lead.name);
  if (direct) return direct;
  const raw = (lead.rawData ?? null) as any;
  if (raw && typeof raw === "object") {
    const candidates = [
      raw?.displayName?.text,
      typeof raw?.displayName === "string" ? raw.displayName : null,
      raw?.name && !/^places\//.test(String(raw.name)) ? raw.name : null,
      raw?.title,
      raw?.businessName
    ];
    for (const c of candidates) {
      const v = cleanBusinessName(c);
      if (v) return v;
    }
  }
  return "";
}

// {{ clave }}  — cualquier clave
const DOUBLE_RE = /\{\{\s*([^{}]{1,60}?)\s*\}\}/g;
// {clave} o [clave] — solo se tocan si la clave es un alias del nombre (no
// queremos reescribir llaves/corchetes normales del texto).
const SINGLE_RE = /(?<!\{)\{\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_ ]{2,40}?)\s*\}(?!\})/g;
const BRACKET_RE = /\[\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ_ ]{2,40}?)\s*\]/g;

/** Sustituye todos los alias del nombre del negocio por `name`. Si `name` está
 *  vacío no toca nada (la barrera de abajo decidirá). */
export function fillBusinessName(text: string, name: string): string {
  const clean = cleanBusinessName(name);
  if (!text || !clean) return text;
  const swap = (m: string, key: string) => (isBusinessNameKey(key) ? clean : m);
  return text.replace(DOUBLE_RE, swap).replace(SINGLE_RE, swap).replace(BRACKET_RE, swap);
}

/**
 * Placeholders que siguen sin resolver: cualquier {{...}} (o llaves dobles
 * sueltas) y los alias del nombre escritos como {nombre} o [nombre].
 */
export function findUnresolvedPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(DOUBLE_RE)) found.add(m[0]);
  for (const m of text.matchAll(SINGLE_RE)) if (isBusinessNameKey(m[1])) found.add(m[0]);
  for (const m of text.matchAll(BRACKET_RE)) if (isBusinessNameKey(m[1])) found.add(m[0]);
  // Llaves dobles sin cerrar (texto cortado, "{{nom", etc.).
  if (!found.size && /\{\{|\}\}/.test(text)) found.add(text.includes("{{") ? "{{…" : "…}}");
  return [...found];
}

export function hasUnresolvedPlaceholders(text: string | null | undefined): boolean {
  return findUnresolvedPlaceholders(text).length > 0;
}

/** ¿El texto contiene el nombre del negocio? (sin distinguir tildes/mayúsculas) */
export function mentionsBusinessName(text: string, name: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const n = norm(cleanBusinessName(name));
  return !!n && norm(text).includes(n);
}
