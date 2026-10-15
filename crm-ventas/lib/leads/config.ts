// Configuración del módulo «Leads y reenvíos» (Workspace.settings.leads).
// Funciones puras: se usan en servidor, en tests y para validar lo que llega
// desde Ajustes.
import crypto from "crypto";
import { last9, normalizePhone } from "@/lib/phone";

export type LeadStatus = { id: string; label: string; color: LeadColor };
export type ForwardTarget = { id: string; label: string; phone: string };
export type LeadsConfig = {
  statuses: LeadStatus[];
  forwardTargets: ForwardTarget[];
  intakeToken: string;
};

export const LEAD_COLORS = ["slate", "sky", "amber", "emerald", "rose", "violet", "orange", "zinc"] as const;
export type LeadColor = (typeof LEAD_COLORS)[number];

export const DEFAULT_LEAD_STATUSES: LeadStatus[] = [
  { id: "nuevo", label: "Nuevo", color: "slate" },
  { id: "contactado", label: "Contactado", color: "sky" },
  { id: "no_contesta", label: "No contesta", color: "amber" },
  { id: "volver_a_llamar", label: "Volver a llamar", color: "orange" },
  { id: "interesado", label: "Interesado", color: "emerald" },
  { id: "cita", label: "Cita agendada", color: "violet" },
  { id: "no_interesado", label: "No interesado", color: "rose" },
  { id: "numero_erroneo", label: "Número erróneo", color: "zinc" },
];

export const MAX_LEAD_STATUSES = 20;
export const MAX_FORWARD_TARGETS = 8;
export const NEW_LEAD_STATUS = "nuevo";

export function randomIntakeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function slugifyStatus(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "estado"
  );
}

function cleanLabel(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeStatuses(input: unknown): LeadStatus[] {
  if (!Array.isArray(input)) return DEFAULT_LEAD_STATUSES.map((s) => ({ ...s }));
  const out: LeadStatus[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_LEAD_STATUSES)) {
    const label = cleanLabel((raw as any)?.label, 40);
    if (!label) continue;
    let id = /^[a-z0-9_]{1,40}$/.test(String((raw as any)?.id ?? "")) ? String((raw as any).id) : slugifyStatus(label);
    let n = 2;
    const base = id;
    while (seen.has(id)) id = `${base.slice(0, 36)}_${n++}`;
    seen.add(id);
    const color = LEAD_COLORS.includes((raw as any)?.color) ? ((raw as any).color as LeadColor) : "slate";
    out.push({ id, label, color });
  }
  return out.length ? out : DEFAULT_LEAD_STATUSES.map((s) => ({ ...s }));
}

export function normalizeForwardTargets(input: unknown, countryCode = "34"): ForwardTarget[] {
  if (!Array.isArray(input)) return [];
  const out: ForwardTarget[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_FORWARD_TARGETS)) {
    const label = cleanLabel((raw as any)?.label, 30);
    const phoneRaw = String((raw as any)?.phone ?? "");
    const phone = phoneRaw.includes("@") ? null : normalizePhone(phoneRaw, countryCode);
    if (!label || !phone) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    const id = /^[A-Za-z0-9_-]{4,40}$/.test(String((raw as any)?.id ?? "")) ? String((raw as any).id) : crypto.randomBytes(5).toString("hex");
    out.push({ id, label, phone });
  }
  return out;
}

// Errores de validación legibles (para avisar en Ajustes de lo que se descartaría).
export function forwardTargetErrors(input: unknown, countryCode = "34"): string[] {
  if (!Array.isArray(input)) return [];
  const errors: string[] = [];
  input.slice(0, MAX_FORWARD_TARGETS).forEach((raw, i) => {
    const label = cleanLabel((raw as any)?.label, 30);
    const phoneRaw = String((raw as any)?.phone ?? "");
    if (!label) errors.push(`Destino ${i + 1}: falta el nombre del botón.`);
    if (!phoneRaw.trim() || phoneRaw.includes("@") || !normalizePhone(phoneRaw, countryCode)) {
      errors.push(`Destino ${i + 1}: el teléfono no es válido (incluye el prefijo si no es español, p. ej. +90…).`);
    }
  });
  if (input.length > MAX_FORWARD_TARGETS) errors.push(`Máximo ${MAX_FORWARD_TARGETS} destinos.`);
  return errors;
}

export function readLeadsConfig(settings: unknown, countryCode = "34"): LeadsConfig {
  const raw = ((settings && typeof settings === "object" ? (settings as any).leads : null) ?? {}) as Record<string, unknown>;
  return {
    statuses: normalizeStatuses(raw.statuses),
    forwardTargets: normalizeForwardTargets(raw.forwardTargets, countryCode),
    intakeToken: typeof raw.intakeToken === "string" && raw.intakeToken.length >= 24 ? raw.intakeToken : "",
  };
}

export function statusById(config: Pick<LeadsConfig, "statuses">, id: string | null | undefined): LeadStatus | null {
  if (!id) return null;
  return config.statuses.find((s) => s.id === id) ?? null;
}

// ¿Este teléfono es uno de los destinos de «ENVIAR A»? Ambos van normalizados
// con prefijo de país, así que se comparan completos (sin falsos positivos
// entre países con los mismos últimos dígitos).
export function isForwardTargetPhone(targets: ForwardTarget[], phone: string | null | undefined): boolean {
  if (!phone || phone.includes("@")) return false;
  const digits = phone.replace(/\D/g, "");
  return targets.some((t) => t.phone === digits);
}

// Número del CRM que lleva el lead: por teléfono (tolerante a prefijos) o por nombre.
export function matchLine<T extends { id: string; label: string; phone: string | null }>(lines: T[], wanted: string | null) {
  if (!wanted) return null;
  const digits = wanted.replace(/\D/g, "");
  if (digits.length >= 9) {
    const tail = digits.slice(-9);
    const byPhone = lines.find((l) => l.phone && last9(l.phone) === tail);
    if (byPhone) return byPhone;
  }
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return lines.find((l) => norm(l.label) === norm(wanted)) ?? null;
}

// ---------------------------------------------------------------------------
// Plantilla del primer mensaje a un lead
// ---------------------------------------------------------------------------

export function firstName(fullName: string | null | undefined): string {
  const clean = String(fullName ?? "").replace(/\s+/g, " ").trim();
  if (!clean || /^\+?[\d\s().-]+$/.test(clean)) return "";
  const first = clean.split(" ")[0];
  return first.charAt(0).toLocaleUpperCase("es-ES") + first.slice(1).toLocaleLowerCase("es-ES");
}

// {nombre} → nombre de pila; {nombre_completo}; {tratamiento}; {campaña}/{campana}.
// Si falta el nombre, «Hola {nombre}, …» queda «Hola, …» (sin huecos raros).
export function renderLeadTemplate(
  template: string,
  vars: { name?: string | null; treatment?: string | null; campaign?: string | null }
): string {
  const nombre = firstName(vars.name);
  const full = String(vars.name ?? "").replace(/\s+/g, " ").trim();
  let out = template;
  if (!nombre) out = out.replace(/\s*\{nombre\}\s*([,!.?])/gi, "$1").replace(/\s+\{nombre\}/gi, "");
  out = out
    .replace(/\{nombre\}/gi, nombre)
    .replace(/\{nombre_completo\}/gi, full && !/^\+?[\d\s().-]+$/.test(full) ? full : nombre)
    .replace(/\{tratamiento\}/gi, String(vars.treatment ?? "").trim())
    .replace(/\{campa(ñ|n)a\}/gi, String(vars.campaign ?? "").trim());
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Datos del lead que llegan de Make (formulario de Meta)
// ---------------------------------------------------------------------------

export type LeadPayload = {
  name: string;
  phone: string;
  email: string | null;
  line: string | null; // teléfono o nombre del número del CRM que lleva el lead
  treatment: string | null;
  campaign: string | null;
  leadId: string | null;
  form: string | null;
  adName: string | null;
  adset: string | null;
  fields: Array<{ label: string; value: string }>;
  message: string | null; // primer mensaje opcional (sustituye a la plantilla del número)
  sendWelcome: boolean;
};

function pick(body: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function humanizeKey(key: string): string {
  const s = key.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toLocaleUpperCase("es-ES") + s.slice(1);
}

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(", ");
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

// Acepta nombres en español o inglés para que el módulo HTTP de Make sea fácil
// de rellenar. `fields`/`respuestas` puede ser un objeto {pregunta: respuesta}
// o la lista field_data de Meta [{name, values:[…]}].
export function parseLeadPayload(input: unknown): { ok: true; lead: LeadPayload } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Se esperaba un objeto JSON" };
  const body = input as Record<string, any>;
  const phone = pick(body, ["telefono", "teléfono", "phone", "phone_number", "telefono_lead", "movil", "móvil"]);
  if (!phone) return { ok: false, error: "Falta el teléfono del lead (campo «telefono»)" };
  const name = pick(body, ["nombre", "name", "full_name", "nombre_completo", "nombre_y_apellidos"]) ?? "";
  const email = pick(body, ["email", "correo", "correo_electronico", "correo_electrónico"]);
  const rawFields = body.respuestas ?? body.fields ?? body.field_data ?? body.answers ?? null;
  const fields: Array<{ label: string; value: string }> = [];
  if (Array.isArray(rawFields)) {
    for (const f of rawFields.slice(0, 40)) {
      const label = cleanLabel(f?.label ?? f?.name ?? f?.pregunta, 120);
      const value = valueText(f?.value ?? f?.values ?? f?.respuesta);
      if (label && value) fields.push({ label: humanizeKey(label), value: value.slice(0, 500) });
    }
  } else if (rawFields && typeof rawFields === "object") {
    for (const [k, v] of Object.entries(rawFields).slice(0, 40)) {
      const value = valueText(v);
      if (k && value) fields.push({ label: humanizeKey(cleanLabel(k, 120)), value: value.slice(0, 500) });
    }
  }
  const sendWelcomeRaw = body.enviar_mensaje ?? body.send_welcome ?? body.sendWelcome;
  const lead: LeadPayload = {
    name: cleanLabel(name, 120),
    phone: phone.slice(0, 40),
    email: email ? cleanLabel(email, 160) : null,
    line: pick(body, ["linea", "línea", "numero_crm", "número_crm", "whatsapp", "line", "telefono_crm"]),
    treatment: (() => {
      const t = pick(body, ["tratamiento", "treatment", "servicio"]);
      return t ? cleanLabel(t, 120) : null;
    })(),
    campaign: (() => {
      const c = pick(body, ["campana", "campaña", "campaign", "campaign_name"]);
      return c ? cleanLabel(c, 200) : null;
    })(),
    leadId: (() => {
      const id = pick(body, ["lead_id", "leadgen_id", "leadId", "id"]);
      return id ? cleanLabel(id, 80) : null;
    })(),
    form: (() => {
      const f = pick(body, ["formulario", "form", "form_id", "form_name"]);
      return f ? cleanLabel(f, 200) : null;
    })(),
    adName: (() => {
      const a = pick(body, ["anuncio", "ad_name", "adName"]);
      return a ? cleanLabel(a, 200) : null;
    })(),
    adset: (() => {
      const a = pick(body, ["conjunto", "adset", "adset_name", "adsetName"]);
      return a ? cleanLabel(a, 200) : null;
    })(),
    fields,
    message: (() => {
      const m = pick(body, ["mensaje", "message", "primer_mensaje"]);
      return m ? m.slice(0, 1500) : null;
    })(),
    sendWelcome: !(sendWelcomeRaw === false || sendWelcomeRaw === "false" || sendWelcomeRaw === "no" || sendWelcomeRaw === 0),
  };
  return { ok: true, lead };
}

export type LeadInfoEntry = {
  id: string | null;
  at: string;
  campaign: string | null;
  treatment: string | null;
  form: string | null;
  adName: string | null;
  adset?: string | null;
  lineLabel: string | null;
  fields: Array<{ label: string; value: string }>;
};

export type LeadInfo = { entries: LeadInfoEntry[] };

export function readLeadInfo(raw: unknown): LeadInfo {
  const entries = Array.isArray((raw as any)?.entries) ? ((raw as any).entries as LeadInfoEntry[]) : [];
  return { entries: entries.filter((e) => e && typeof e === "object").slice(0, 10) };
}

// Añade una entrada (la más reciente primero). Devuelve null si ya existía ese lead_id.
export function appendLeadInfo(raw: unknown, entry: LeadInfoEntry): LeadInfo | null {
  const current = readLeadInfo(raw);
  if (entry.id && current.entries.some((e) => e.id === entry.id)) return null;
  return { entries: [entry, ...current.entries].slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Intentos de contacto (cuántas veces y a qué hora se intentó contactar)
// ---------------------------------------------------------------------------

export type ContactAttempt = { id: string; at: string; by: string | null; byName: string | null; note: string | null };
export const MAX_CONTACT_ATTEMPTS = 100;

export function readAttempts(raw: unknown): ContactAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object" && typeof (a as any).id === "string" && !Number.isNaN(Date.parse((a as any).at)))
    .map((a: any) => ({
      id: String(a.id),
      at: new Date(a.at).toISOString(),
      by: typeof a.by === "string" ? a.by : null,
      byName: typeof a.byName === "string" ? a.byName : null,
      note: typeof a.note === "string" && a.note.trim() ? a.note : null,
    }))
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

// La hora puede ser pasada (se apunta después de llamar) pero no futura ni
// absurdamente antigua.
export function validAttemptDate(value: unknown, now = new Date()): Date | null {
  if (value === undefined || value === null || value === "") return now;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime() + 5 * 60_000) return null;
  if (d.getTime() < now.getTime() - 400 * 86_400_000) return null;
  return d;
}

export function addAttempt(
  raw: unknown,
  attempt: { at: Date; by: string | null; byName: string | null; note?: string | null }
): ContactAttempt[] {
  const list = readAttempts(raw);
  const next: ContactAttempt = {
    id: crypto.randomBytes(5).toString("hex"),
    at: attempt.at.toISOString(),
    by: attempt.by,
    byName: attempt.byName ? cleanLabel(attempt.byName, 60) : null,
    note: attempt.note ? cleanLabel(attempt.note, 200) || null : null,
  };
  return [...list, next].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-MAX_CONTACT_ATTEMPTS);
}

export function removeAttempt(raw: unknown, id: string): ContactAttempt[] {
  return readAttempts(raw).filter((a) => a.id !== id);
}
