/**
 * Constantes y tipos para la configuración editorial por cliente.
 * Migrado de NV Dashboard (class-cliente-meta.php).
 */

export type FormatPreset = {
  key: string;
  label: string;
  width: number;
  height: number;
  ratio: string;
};

export const FORMAT_PRESETS: FormatPreset[] = [
  { key: "ig_feed_4_5", label: "Instagram Feed (4:5)", width: 1080, height: 1350, ratio: "4:5" },
  { key: "ig_square_1_1", label: "Instagram Cuadrado (1:1)", width: 1080, height: 1080, ratio: "1:1" },
  { key: "ig_reel_9_16", label: "Reel / Story (9:16)", width: 1080, height: 1920, ratio: "9:16" },
  { key: "ig_landscape_16_9", label: "Instagram Landscape (16:9)", width: 1920, height: 1080, ratio: "16:9" },
  { key: "ig_story_9_16", label: "Instagram Story (9:16)", width: 1080, height: 1920, ratio: "9:16" },
  { key: "tiktok_9_16", label: "TikTok (9:16)", width: 1080, height: 1920, ratio: "9:16" },
  { key: "yt_16_9", label: "YouTube (16:9)", width: 1920, height: 1080, ratio: "16:9" },
  { key: "yt_short_9_16", label: "YouTube Short (9:16)", width: 1080, height: 1920, ratio: "9:16" },
  { key: "pinterest_2_3", label: "Pinterest (2:3)", width: 1000, height: 1500, ratio: "2:3" },
  { key: "linkedin_1_91_1", label: "LinkedIn (1.91:1)", width: 1200, height: 627, ratio: "1.91:1" },
  { key: "fb_link_1_91_1", label: "Facebook Link (1.91:1)", width: 1200, height: 630, ratio: "1.91:1" },
  { key: "twitter_16_9", label: "X / Twitter (16:9)", width: 1600, height: 900, ratio: "16:9" },
  { key: "custom", label: "Personalizado", width: 0, height: 0, ratio: "custom" }
];

export type EditorialFormat = "imagen" | "reel" | "carrusel" | "story" | "video";

export const EDITORIAL_FORMATS: { key: EditorialFormat; label: string; defaultPreset: string }[] = [
  { key: "imagen", label: "Imagen (Feed)", defaultPreset: "ig_feed_4_5" },
  { key: "reel", label: "Reel", defaultPreset: "ig_reel_9_16" },
  { key: "carrusel", label: "Carrusel", defaultPreset: "ig_square_1_1" },
  { key: "story", label: "Story", defaultPreset: "ig_story_9_16" },
  { key: "video", label: "Video", defaultPreset: "yt_16_9" }
];

export type DimensionConfig = { width: number; height: number; preset: string };
export type DimensionsByFormat = Record<EditorialFormat, DimensionConfig>;

export function defaultDimensionsByFormat(): DimensionsByFormat {
  const out: any = {};
  for (const f of EDITORIAL_FORMATS) {
    const preset = FORMAT_PRESETS.find((p) => p.key === f.defaultPreset)!;
    out[f.key] = { width: preset.width, height: preset.height, preset: preset.key };
  }
  return out as DimensionsByFormat;
}

/**
 * Tipos semánticos de subcarpetas de Drive (y de refs visuales).
 * El plugin usa estos códigos para que la IA sepa qué tipo de imagen es y
 * la categorice correctamente al generar publicaciones.
 */
export const SUBFOLDER_TYPES = [
  { key: "persona_destacada", label: "👤 Persona destacada (CEO, fundador)" },
  { key: "equipo", label: "👥 Equipo (trabajadores, médicos)" },
  { key: "pacientes_usuarios", label: "🧍 Pacientes / Usuarios" },
  { key: "instalaciones", label: "🏢 Instalaciones (clínica, oficina)" },
  { key: "productos", label: "📦 Productos / Catálogo" },
  { key: "logo_brand", label: "🎨 Logo / Brand assets" },
  { key: "otros", label: "📁 Otros" }
] as const;

export type SubfolderType = (typeof SUBFOLDER_TYPES)[number]["key"];

export const REFERENCE_IMAGE_TYPES = [
  { key: "persona_destacada", label: "Persona destacada" },
  { key: "equipo", label: "Equipo" },
  { key: "instalaciones", label: "Instalaciones" },
  { key: "pacientes_usuarios", label: "Pacientes / Usuarios" },
  { key: "productos", label: "Productos" },
  { key: "logo_brand", label: "Logo / Brand" },
  { key: "general", label: "General" }
] as const;

export type ReferenceImageType = (typeof REFERENCE_IMAGE_TYPES)[number]["key"];

export const LOGO_POSITIONS = [
  { key: "br", label: "Esquina inferior derecha (recomendado)" },
  { key: "bl", label: "Esquina inferior izquierda" },
  { key: "tr", label: "Esquina superior derecha" },
  { key: "tl", label: "Esquina superior izquierda" }
] as const;

export const VISUAL_PATTERNS = [
  {
    key: "clean",
    label: "Limpio",
    description: "Texto plano (blanco o color brand) directamente sobre la foto. Aspecto editorial sutil."
  },
  {
    key: "frame",
    label: "Frame",
    description: "Franja diagonal de color brand + cápsulas para el texto (estilo Guardamuebles Reva)."
  }
] as const;

export const FIDELITY_BANDS = [
  { from: 0, to: 30, label: "Libertad total — IA ignora refs y compone desde cero" },
  { from: 30, to: 70, label: "Inspiración suave (default) — usa el mood y la composición" },
  { from: 70, to: 100, label: "Replicación estricta — copia el patrón visual" }
];

export const DRIVE_MODES = [
  { key: "configured", label: "Sí, refs configuradas" },
  { key: "pending", label: "Sí, pero pendientes de configurar" },
  { key: "no_drive_refs", label: "Este cliente no usa Drive refs" }
] as const;

export const FONT_WEIGHTS = [
  { key: "regular", label: "Regular / Thin" },
  { key: "bold", label: "Bold" }
] as const;

export type ReferenceImage = {
  url: string;
  type: ReferenceImageType;
  personName?: string;
};

export type FontEntry = {
  url: string;
  name: string;
  weight: "regular" | "bold";
};

export type DriveSubfolder = {
  name: string;
  id: string;
  type: SubfolderType;
};
