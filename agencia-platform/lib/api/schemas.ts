import { z } from "zod";

export const clientCreateSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"]).default("ACTIVE"),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mrr: z.number().int().min(0).default(0),
  notes: z.string().optional()
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
  visualPattern: z.enum(["clean", "frame"]).optional(),
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
    .optional()
});

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  clientId: z.string().optional(),
  description: z.string().optional(),
  color: z.string().default("bg-brand-500")
});

export const taskCreateSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  // Antes era enum cerrado; ahora libre (columnas configurables por workspace).
  status: z.string().min(1).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().datetime().optional(),
  assigneeIds: z.array(z.string()).default([]),
  parentId: z.string().optional()
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
