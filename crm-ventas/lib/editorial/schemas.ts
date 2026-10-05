/**
 * Schema de la ficha editorial de la marca. Portado de
 * `clientEditorialMetaSchema` del Hub (lib/api/schemas.ts).
 *
 * Cambios CRM: sin Google Drive (driveMode/driveRootId/driveSubfolders), sin
 * vinculación de Meta Ads para campañas de Sonia (metaAdAccountId…) y sin
 * selector de modelo de imagen (el negocio no elige modelos ni claves). Se
 * añaden `name`, `industry` e `imageGlobalAvoid`, que en el Hub se editaban
 * en la ficha general del cliente y en el CRM solo existen aquí.
 */
import { z } from "zod";
import { VISUAL_PATTERNS } from "@/lib/editorial/client-meta";
import { assetUrlSchema } from "@/lib/editorial/assets";

const VISUAL_PATTERN_KEYS = VISUAL_PATTERNS.map((p) => p.key) as [string, ...string[]];

// Todos opcionales: el form va guardando lo que se va rellenando.
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color hex inválido");

export const brandEditorialMetaSchema = z.object({
  // Identidad de la marca (CRM)
  name: z.string().trim().min(1).max(200).optional(),
  industry: z.string().max(200).nullable().optional(),
  // Brief
  brandBrief: z.string().max(20000).nullable().optional(),
  // CRM: la web que el negocio puso en Paula puede venir sin protocolo
  // ("estoresmalaga.com"); se completa con https:// antes de validar.
  website: z.preprocess(
    (value) => (typeof value === "string" && value.trim() && !/^https?:\/\//i.test(value.trim()) ? `https://${value.trim()}` : value),
    z.string().url().or(z.literal("")).nullable().optional()
  ),
  // Colores
  brandColorPrimary: hexColor.optional(),
  brandColorAccent: hexColor.optional(),
  brandColorText: hexColor.optional(),
  // Logo
  logoUrl: assetUrlSchema.or(z.literal("")).nullable().optional(),
  logoPosition: z.enum(["br", "bl", "tr", "tl"]).optional(),
  // Patrón visual
  visualPattern: z.enum(VISUAL_PATTERN_KEYS).optional(),
  refsFidelity: z.number().int().min(0).max(100).optional(),
  // Competidores
  competitors: z.string().max(20000).nullable().optional(),
  // Dimensiones por formato
  dimensionsByFormat: z
    .record(
      z.enum(["imagen", "reel", "carrusel", "story", "video"]),
      z.object({
        width: z.number().int().positive().max(8000),
        height: z.number().int().positive().max(8000),
        preset: z.string().max(60)
      })
    )
    .optional(),
  // Refs visuales
  referenceImages: z
    .array(
      z.object({
        url: assetUrlSchema,
        type: z.enum([
          "persona_destacada",
          "equipo",
          "instalaciones",
          "pacientes_usuarios",
          "productos",
          "logo_brand",
          "general"
        ]),
        personName: z.string().max(120).optional()
      })
    )
    .max(60)
    .optional(),
  // Plantillas visuales subidas (imágenes de ejemplo/layout)
  patternTemplates: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        url: assetUrlSchema,
        name: z.string().min(1).max(120),
        notes: z.string().max(500).optional()
      })
    )
    .max(40)
    .optional(),
  // Fuentes
  fonts: z
    .array(
      z.object({
        url: assetUrlSchema,
        name: z.string().max(120),
        weight: z.enum(["regular", "bold"])
      })
    )
    .max(10)
    .optional(),
  // Guía de estilo (raramente se setea a mano; suele venir del IA)
  styleGuideCached: z.string().max(20000).nullable().optional(),
  styleGuideHash: z.string().max(100).nullable().optional(),
  // Preset del modal "Generar mes con IA" para la marca. Sin schema
  // estricto: la UI persiste lo que necesite (count, networks, mix,
  // copyLength, perNetworkCopy, extraGuidance, status, generateImages,
  // imageQuality). null para resetear al default global.
  editorialDefaults: z.record(z.string(), z.any()).nullable().optional(),
  // Negativo permanente de imagen: cosas que NUNCA deben aparecer.
  imageGlobalAvoid: z.string().max(4000).nullable().optional()
});

export type BrandEditorialMetaInput = z.infer<typeof brandEditorialMetaSchema>;

/** Campos de la ficha que se devuelven a la UI (equivale a META_SELECT del Hub). */
export const BRAND_META_SELECT = {
  id: true,
  name: true,
  industry: true,
  brandBrief: true,
  website: true,
  brandColorPrimary: true,
  brandColorAccent: true,
  brandColorText: true,
  logoUrl: true,
  logoPosition: true,
  visualPattern: true,
  refsFidelity: true,
  competitors: true,
  dimensionsByFormat: true,
  referenceImages: true,
  patternTemplates: true,
  fonts: true,
  styleGuideCached: true,
  styleGuideHash: true,
  editorialDefaults: true,
  imageGlobalAvoid: true
} as const;
