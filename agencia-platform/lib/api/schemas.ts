import { z } from "zod";
import { VISUAL_PATTERNS } from "@/lib/editorial/client-meta";

const VISUAL_PATTERN_KEYS = VISUAL_PATTERNS.map((p) => p.key) as [string, ...string[]];

export const SERVICIO_KEYS = [
  "diseno_web",
  "seo_web",
  "seo_ia",
  "gmb",
  "sem",
  "gestion_redes",
  "campana_redes",
  "resenas_qr",
  "comercio_electronico",
  "mantenimiento",
  "servidor",
  "dominio"
] as const;
export type ServicioKey = (typeof SERVICIO_KEYS)[number];

export const SERVICIO_LABELS: Record<ServicioKey, string> = {
  diseno_web: "Diseño Web",
  seo_web: "SEO WEB",
  seo_ia: "SEO IA",
  gmb: "GMB",
  sem: "SEM",
  gestion_redes: "Gestión Redes",
  campana_redes: "Campaña Redes",
  resenas_qr: "Reseñas QR",
  comercio_electronico: "Comercio Electrónico",
  mantenimiento: "Mantenimiento",
  servidor: "Servidor",
  dominio: "Dominio"
};

export const clientCreateSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"]).default("ACTIVE"),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mrr: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  // Secciones nuevas del modal de edición de cliente.
  infoGeneral: z.string().nullable().optional(),
  accesos: z.string().nullable().optional(),
  servicios: z.array(z.enum(SERVICIO_KEYS)).optional(),
  kitDigital: z.boolean().optional(),
  prioridad: z.enum(["ALTA", "NORMAL", "BAJA"]).optional(),
  // Datos fiscales (para el gestor de facturas).
  legalName: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  fiscalAddress: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional()
});

// Schema de la ficha editorial del cliente (NV Dashboard). Todos opcionales:
// el form va guardando lo que se va rellenando.
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color hex inválido");

export const clientEditorialMetaSchema = z.object({
  // Brief
  brandBrief: z.string().nullable().optional(),
  website: z.string().url().or(z.literal("")).nullable().optional(),
  // Colores
  brandColorPrimary: hexColor.optional(),
  brandColorAccent: hexColor.optional(),
  brandColorText: hexColor.optional(),
  // Logo
  logoUrl: z.string().url().or(z.literal("")).nullable().optional(),
  logoPosition: z.enum(["br", "bl", "tr", "tl"]).optional(),
  // Patrón visual
  visualPattern: z.enum(VISUAL_PATTERN_KEYS).optional(),
  refsFidelity: z.number().int().min(0).max(100).optional(),
  // Competidores
  competitors: z.string().nullable().optional(),
  // Dimensiones por formato
  dimensionsByFormat: z
    .record(
      z.enum(["imagen", "reel", "carrusel", "story", "video"]),
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        preset: z.string()
      })
    )
    .optional(),
  // Refs visuales
  referenceImages: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum([
          "persona_destacada",
          "equipo",
          "instalaciones",
          "pacientes_usuarios",
          "productos",
          "logo_brand",
          "general"
        ]),
        personName: z.string().optional()
      })
    )
    .optional(),
  // Plantillas visuales subidas (imágenes de ejemplo/layout)
  patternTemplates: z
    .array(
      z.object({
        id: z.string().min(1),
        url: z.string().url(),
        name: z.string().min(1).max(120),
        notes: z.string().max(500).optional()
      })
    )
    .optional(),
  // Fuentes
  fonts: z
    .array(
      z.object({
        url: z.string().url(),
        name: z.string(),
        weight: z.enum(["regular", "bold"])
      })
    )
    .optional(),
  // Guía de estilo (raramente se setea a mano; suele venir del IA)
  styleGuideCached: z.string().nullable().optional(),
  styleGuideHash: z.string().nullable().optional(),
  // Drive
  driveMode: z.enum(["configured", "pending", "no_drive_refs"]).optional(),
  driveRootId: z.string().nullable().optional(),
  driveSubfolders: z
    .array(
      z.object({
        name: z.string(),
        id: z.string(),
        type: z.enum([
          "persona_destacada",
          "equipo",
          "pacientes_usuarios",
          "instalaciones",
          "productos",
          "logo_brand",
          "otros"
        ])
      })
    )
    .optional(),
  imageModel: z.enum(["openai-gpt-image-1", "freepik-seedream-v4"]).nullable().optional(),
  // Preset del modal "Generar mes con IA" para este cliente. Sin schema
  // estricto: la UI persiste lo que necesite (count, networks, mix,
  // copyLength, perNetworkCopy, extraGuidance, status, generateImages,
  // imageQuality). null para resetear al default global.
  editorialDefaults: z.record(z.string(), z.any()).nullable().optional(),
  // Meta Ads: vinculación cuenta/página por cliente. Cuando una tarea de
  // campaña tiene clientId, Sonia resuelve estos valores automáticamente
  // (sin pegar la URL del Ads Manager).
  metaAdAccountId: z.string().nullable().optional(),
  metaPageId: z.string().nullable().optional(),
  metaInstagramId: z.string().nullable().optional(),
  metaLeadEmails: z.string().nullable().optional()
});

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  clientId: z.string().optional().nullable(),
  description: z.string().optional(),
  color: z.string().default("bg-brand-500"),
  emoji: z.string().max(8).optional().nullable(),
  managerUserId: z.string().optional().nullable()
});

export const taskCreateSchema = z.object({
  projectId: z.string(),
  // Lista completa de proyectos donde aparece la tarea. Si llega, el
  // primero pasa a ser el principal (projectId) y los demás se guardan
  // como TaskProject. Si no llega, se respeta projectId tal cual.
  projectIds: z.array(z.string()).optional(),
  // Multi-proyecto: columna específica DENTRO de cada proyecto extra
  // (key = projectId, value = id de la columna en ese proyecto). El
  // proyecto principal usa `status` global.
  extraProjectStatuses: z.record(z.string(), z.string()).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  // Antes era enum cerrado; ahora libre (columnas configurables por workspace).
  status: z.string().min(1).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().datetime().optional(),
  dueAllDay: z.boolean().optional(),
  // Reglas de notificación por dueDate. null = defaults (las 3 activas).
  notifyDueRules: z.array(z.enum(["day_7am", "1h_before", "10min_before"])).nullable().optional(),
  assigneeIds: z.array(z.string()).default([]),
  parentId: z.string().optional(),
  // Plantilla utilizada para crear esta task (si aplica).
  templateId: z.string().optional().nullable(),
  // Valores de custom fields definidos por la plantilla. Objeto plano
  // { fieldId: value } donde value es string | number | boolean | string[].
  customData: z.record(z.string(), z.any()).optional().nullable(),
  // Tareas flash: checklist [{id, text, done}].
  flashTasks: z
    .array(z.object({ id: z.string(), text: z.string(), done: z.boolean() }))
    .optional()
    .nullable(),
  // Recurrencia: relanza la tarea (Sonia) cada periodo. Ver lib/tasks/recurrence.
  recurrence: z.enum(["none", "daily", "every_2_days", "weekly", "biweekly", "monthly"]).optional()
});

export const documentCreateSchema = z.object({
  title: z.string().min(1).default("Sin título"),
  parentId: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional()
});

export const eventCreateSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  type: z.enum(["PUBLICATION", "MEETING", "DEADLINE", "CAMPAIGN", "OTHER"]).default("MEETING"),
  clientId: z.string().optional(),
  allDay: z.boolean().default(false)
});

// ──────────────────────────────────────────────────────────────────
// Facturación (gestor de facturas)
// ──────────────────────────────────────────────────────────────────
const invoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  taxRate: z.number().min(0).max(100).default(21),
  discountPct: z.number().min(0).max(100).optional()
});

const recurrenceConfigSchema = z.object({
  intervalMonths: z.number().int().min(1).max(60).default(1),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  nextRunAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable()
});

export const invoiceCreateSchema = z.object({
  type: z.enum(["NORMAL", "RECTIFICATIVA", "PROFORMA", "PRESUPUESTO"]).default("NORMAL"),
  status: z.enum(["DRAFT", "ISSUED", "PAID", "CANCELLED", "SENT", "ACCEPTED", "REJECTED"]).default("DRAFT"),
  clientId: z.string().nullable().optional(),
  issuerId: z.string().nullable().optional(),
  series: z.string().max(8).optional().nullable(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.enum(["EUR", "USD"]).default("EUR"),
  paymentMethod: z.enum(["STRIPE", "TRANSFER", "REMITTANCE", "CARD", "CASH", "OTHER"]).default("STRIPE"),
  lines: z.array(invoiceLineSchema).min(1),
  notes: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  rectifiesInvoiceId: z.string().nullable().optional(),
  rectifyReason: z.string().nullable().optional(),
  recurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional()
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial();

export const invoiceIssuerSchema = z.object({
  name: z.string().min(1),
  legalName: z.string().nullable().optional(),
  taxId: z.string().min(1),
  address: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  countryCode: z.string().default("ESP"),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  web: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  personType: z.enum(["F", "J"]).default("J"),
  residenceType: z.enum(["R", "E", "U"]).default("R"),
  isDefault: z.boolean().optional()
});
export const invoiceIssuerUpdateSchema = invoiceIssuerSchema.partial();
