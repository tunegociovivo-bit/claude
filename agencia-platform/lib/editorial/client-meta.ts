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
    description: "Texto plano (blanco o color brand) directamente sobre la foto. Aspecto editorial sutil.",
    promptHint:
      "clean editorial look, plain text over photo, generous negative space, no decorative frames"
  },
  {
    key: "frame",
    label: "Frame",
    description: "Franja diagonal de color brand + cápsulas para el texto (estilo Guardamuebles Reva).",
    promptHint:
      "bold diagonal color band in the brand color across a corner, geometric framing, capsule/pill shapes behind text, dynamic composition"
  },
  {
    key: "bold_blocks",
    label: "Bloques",
    description: "Bloques de color sólidos estilo Swiss/Bauhaus. Composición geométrica fuerte.",
    promptHint:
      "Swiss/Bauhaus design, solid color blocks in brand palette, strong grid, geometric shapes, high-contrast modern layout"
  },
  {
    key: "magazine",
    label: "Revista",
    description: "Estilo revista premium: mucho espacio negativo, tipografía grande, foto protagonista.",
    promptHint:
      "high-end magazine editorial style, large hero photo, lots of white/negative space, refined premium aesthetic, fashion-magazine composition"
  },
  {
    key: "gradient",
    label: "Degradado",
    description: "Degradado suave de color de marca sobre la foto. Moderno y limpio.",
    promptHint:
      "smooth brand-color gradient overlay fading over the photo, modern app-like aesthetic, vibrant but clean"
  },
  {
    key: "duotone",
    label: "Duotono",
    description: "Foto en duotono con los colores de marca. Muy reconocible y coherente.",
    promptHint:
      "duotone treatment of the photo using the two brand colors, Spotify-like bold duotone, striking and brand-consistent"
  },
  {
    key: "minimal_center",
    label: "Minimal centrado",
    description: "Minimalista: sujeto centrado, fondo limpio uniforme, foco absoluto en el producto.",
    promptHint:
      "ultra minimal, centered subject/product, clean uniform solid background, soft studio lighting, lots of breathing room"
  },
  {
    key: "collage",
    label: "Collage",
    description: "Estilo collage/recortes con elementos superpuestos. Juvenil y dinámico.",
    promptHint:
      "cut-out collage style, layered overlapping elements, scrapbook/zine aesthetic, playful youthful energy, mixed textures"
  },
  {
    key: "badge",
    label: "Sello / Oferta",
    description: "Sello o insignia circular para destacar oferta/claim. Ideal promociones.",
    promptHint:
      "promotional layout with a circular badge/seal/sticker highlighting an offer, sale-tag energy, eye-catching CTA area"
  },
  {
    key: "luxury_dark",
    label: "Lujo oscuro",
    description: "Fondo oscuro elegante, dorados/acentos, sensación premium y exclusiva.",
    promptHint:
      "luxury dark aesthetic, deep dark background, gold/metallic accents, elegant premium exclusive mood, dramatic lighting"
  },
  {
    key: "cinematic",
    label: "Cinemático",
    description: "Estética de cine: paleta teal/orange, grano de película, profundidad de campo marcada.",
    promptHint:
      "cinematic film still, anamorphic look, teal-and-orange color grading, subtle film grain, shallow depth of field, dramatic mood, widescreen-feel composition"
  },
  {
    key: "vintage",
    label: "Vintage / Retro",
    description: "Paleta sepia/años 70-80, tipografías retro, sensación analógica y nostálgica.",
    promptHint:
      "vintage retro aesthetic, warm sepia/70s-80s palette, slightly faded analog look, retro-style typography hints, nostalgic mood, soft natural light"
  },
  {
    key: "pastel",
    label: "Pastel / Wellness",
    description: "Colores pasteles suaves, luz difusa. Perfecto para wellness, beauty soft, infantil.",
    promptHint:
      "soft pastel palette, milky/dreamy diffused light, airy and gentle composition, wellness/spa/beauty mood, calm and feminine premium feel"
  },
  {
    key: "handdrawn",
    label: "Ilustrado / Dibujado a mano",
    description: "Estilo ilustración con trazos dibujados a mano, doodles y notas decorativas.",
    promptHint:
      "hand-drawn illustration style, sketchy line art, handwritten doodles and notes as decorative accents, marker/pen texture, friendly editorial-illustration vibe"
  },
  {
    key: "brutalism",
    label: "Brutalismo",
    description: "Tipografía enorme, layouts crudos, contrastes duros, estética anti-pulida.",
    promptHint:
      "brutalist web/print design, oversized raw typography, hard contrasts, unrefined grid breaks, harsh black/white with brand accent, intentional rough edges"
  },
  {
    key: "y2k_chrome",
    label: "Y2K / Cromado",
    description: "Futurismo retro Y2K, gradientes vibrantes y reflejos cromados/líquidos.",
    promptHint:
      "Y2K aesthetic, glossy chrome/liquid metal accents, vibrant gradients, futuristic 2000s pop vibe, holographic highlights, bold modern typography hints"
  },
  {
    key: "botanical",
    label: "Botánico / Natural",
    description: "Verdes, hojas, texturas orgánicas. Para wellness, eco, herbal, hortícola.",
    promptHint:
      "botanical natural composition, leaves and foliage framing, organic earthy palette of greens and warm neutrals, soft daylight, eco/herbal mood"
  },
  {
    key: "typographic",
    label: "Tipográfico",
    description: "Mensaje protagonista: tipografía enorme, casi sin imagen. Foco total en el texto.",
    promptHint:
      "type-first composition, oversized expressive typography as the main visual element, minimal photographic content, strong brand-color background, editorial poster feel"
  },
  {
    key: "overhead_flatlay",
    label: "Flat lay (vista cenital)",
    description: "Composición desde arriba (cenital). Ideal para producto, restaurantes, food, retail.",
    promptHint:
      "overhead top-down flat lay composition, objects arranged on a clean surface, natural soft light, magazine-style food/product styling, generous negative space"
  },
  {
    key: "isometric_3d",
    label: "3D isométrico",
    description: "Render 3D isométrico moderno (tech, SaaS, ilustración corporativa amigable).",
    promptHint:
      "modern isometric 3D render illustration, clean geometric shapes, soft shadows, friendly tech/SaaS aesthetic, brand-color palette, subtle gradients"
  }
] as const;

/** Devuelve el promptHint de un patrón por su key (o el de clean). */
export function visualPatternHint(key: string | null | undefined): string {
  const p = VISUAL_PATTERNS.find((v) => v.key === key);
  return p?.promptHint ?? VISUAL_PATTERNS[0].promptHint;
}

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

/**
 * Plantilla visual subida por el cliente: una imagen de ejemplo/layout que
 * el usuario puede elegir por publicación como guía de estilo para la IA.
 */
export type PatternTemplate = {
  id: string;
  url: string;
  name: string;
  notes?: string;
};

export type DriveSubfolder = {
  name: string;
  id: string;
  type: SubfolderType;
};
