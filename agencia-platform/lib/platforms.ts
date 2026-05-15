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
import { Star, Mic, FileText, Download, MessageSquare, Sparkles } from "lucide-react";

export type PlatformKey =
  | "reviews"
  | "voice_reviews"
  | "nv_dashboard"
  | "nv_leads"
  | "redactor_ia"
  | "asana_import";

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
  }
];

export type PlatformConfig = {
  enabled: boolean;
  memberIds: string[]; // userIds del workspace con acceso. Vacío = todos del workspace.
};

export type PlatformsSettings = Record<string, PlatformConfig>;

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
): PlatformDef[] {
  const cfg: PlatformsSettings = (settings?.platforms ?? {}) as any;
  return PLATFORMS.filter((p) => {
    const c = cfg[p.key];
    if (!c?.enabled) return false;
    if (isAdmin) return true;
    if (!c.memberIds || c.memberIds.length === 0) return true;
    return c.memberIds.includes(userId);
  });
}
