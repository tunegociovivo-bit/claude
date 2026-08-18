/**
 * Catálogo de "plataformas" (= plugins migrados o herramientas internas)
 * que el admin puede mostrar en el sidebar y asignar a trabajadores
 * específicos.
 *
 * La configuración por workspace vive en:
 *   workspace.settings.platforms = {
 *     [platformKey]: { enabled: boolean, memberIds: string[] }
 *   }
 *
 * Si una plataforma no tiene config, se considera DESHABILITADA por defecto
 * (el admin la activa explícitamente en /admin/plataformas).
 */

import { LucideIcon } from "lucide-react";
import { Star, Mic, FileText, Download, MessageSquare, Sparkles, Megaphone, Puzzle, Store, Landmark } from "lucide-react";

export type PlatformKey =
  | "reviews"
  | "voice_reviews"
  | "nv_dashboard"
  | "nv_leads"
  | "redactor_ia"
  | "asana_import"
  | "meta_campaigns"
  | "chrome_extension"
  | "bubui_directorio"
  | "subvenciones";

export type PlatformDef = {
  key: PlatformKey;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Si está migrado y operativo */
  available: boolean;
  /** Texto explicativo si no está disponible */
  pendingMessage?: string;
  /** Visible en el sidebar aunque el workspace no la haya configurado todavía.
   *  El admin puede desactivarla explícitamente en /admin/plataformas. */
  defaultEnabled?: boolean;
};

export const PLATFORMS: PlatformDef[] = [
  {
    key: "reviews",
    label: "Generador Reseñas IA",
    description: "Reseñas generadas con OpenAI para Trustpilot/Google.",
    href: "/admin/reviews",
    icon: Star,
    available: true
  },
  {
    key: "voice_reviews",
    label: "Voice Reviews",
    description: "Reseñas guiadas por voz con Whisper + Claude.",
    href: "/admin/voice-reviews",
    icon: Mic,
    available: true
  },
  {
    key: "redactor_ia",
    label: "Redactor IA",
    description: "Copy para redes sociales, blog, email, anuncios.",
    href: "/admin/redactor",
    icon: Sparkles,
    available: true
  },
  {
    key: "asana_import",
    label: "Importar desde Asana",
    description: "Migra tareas/proyectos/comentarios de Asana.",
    href: "/admin/asana",
    icon: Download,
    available: true
  },
  {
    key: "nv_dashboard",
    label: "Calendario editorial",
    description: "Publicaciones multi-cliente con estados, programación y revisiones (migrado de NV Dashboard).",
    href: "/admin/editorial",
    icon: FileText,
    available: true
  },
  {
    key: "nv_leads",
    label: "Leads (NV Leads Pro)",
    description: "Captación de leads de Google My Business + secuencias WhatsApp.",
    href: "/admin/leads",
    icon: MessageSquare,
    available: true
  },
  {
    key: "meta_campaigns",
    label: "Campañas Meta",
    description: "Supervisa y crea campañas publicitarias en Meta con métricas, recomendaciones y generación asistida por IA.",
    href: "/campanas-meta",
    icon: Megaphone,
    available: true
  },
  {
    key: "chrome_extension",
    label: "Extensión Chrome",
    description: "Descarga e instala la extensión para grabar reuniones (Meet/Teams/Zoom) y recibir avisos de tareas y menciones fuera del Hub.",
    href: "/admin/extension",
    icon: Puzzle,
    available: true
  },
  {
    key: "bubui_directorio",
    label: "Bubui · Directorio SEO",
    description: "Gestiona el directorio de comercios de Bubui: genera el contenido SEO con IA, geocodifica negocios y revisa el estado de las páginas por nicho y localidad.",
    href: "/admin/bubui",
    icon: Store,
    available: true
  },
  {
    key: "subvenciones",
    label: "Cazador de Subvenciones IA",
    description: "Detecta convocatorias públicas abiertas (BDNS) y las cruza con cada cliente: qué le encaja, por qué califica y qué necesita para solicitarla.",
    href: "/admin/subvenciones",
    icon: Landmark,
    available: true,
    defaultEnabled: true
  }
];

export type PlatformConfig = {
  enabled: boolean;
  memberIds: string[]; // userIds del workspace con acceso. Vacío = todos del workspace.
  /** Override del label que aparece en sidebar y admin. Si vacío, se usa PlatformDef.label */
  customLabel?: string;
  /** Override de la descripción */
  customDescription?: string;
};

export type PlatformsSettings = Record<string, PlatformConfig>;

/**
 * Mezcla el catálogo base con los overrides per-workspace y devuelve una
 * lista de plataformas "efectivas" para mostrar en UI.
 */
export function mergedPlatforms(settings: any): (PlatformDef & { effectiveLabel: string; effectiveDescription: string })[] {
  const cfg: PlatformsSettings = (settings?.platforms ?? {}) as any;
  return PLATFORMS.map((p) => {
    const c = cfg[p.key];
    return {
      ...p,
      effectiveLabel: c?.customLabel?.trim() || p.label,
      effectiveDescription: c?.customDescription?.trim() || p.description
    };
  });
}

/**
 * Resuelve qué plataformas son visibles para un usuario dado, dadas las
 * settings del workspace y su rol.
 *  - ADMIN del workspace: ve todas las habilitadas, ignorando memberIds.
 *  - Otros: ven una plataforma si está habilitada Y (memberIds vacía OR
 *    su userId está en memberIds).
 */
export function platformsVisibleTo(
  settings: any,
  userId: string,
  isAdmin: boolean
): (PlatformDef & { effectiveLabel: string })[] {
  const cfg: PlatformsSettings = (settings?.platforms ?? {}) as any;
  return PLATFORMS
    .filter((p) => {
      const c = cfg[p.key];
      // Sin config explícita → usa defaultEnabled del catálogo. Con config →
      // manda el flag enabled (permite que el admin la desactive a propósito).
      const enabled = c ? !!c.enabled : !!p.defaultEnabled;
      if (!enabled) return false;
      if (isAdmin) return true;
      if (!c.memberIds || c.memberIds.length === 0) return true;
      return c.memberIds.includes(userId);
    })
    .map((p) => ({
      ...p,
      effectiveLabel: cfg[p.key]?.customLabel?.trim() || p.label
    }));
}
