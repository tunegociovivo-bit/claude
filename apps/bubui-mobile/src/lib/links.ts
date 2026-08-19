/**
 * Resolución y apertura del enlace de una oferta recibido en un push.
 *
 * Se extrae a su propio módulo para poder reutilizarlo tanto desde
 * `push.ts` (notificaciones de expo-notifications) como desde
 * `rich-notifications.ts` (notificaciones con imagen de Notifee) sin crear
 * dependencias circulares entre ambos.
 */

import { Linking } from "react-native";
import { API_BASE } from "./api";

export function retoTokenFromPath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const m = /\/reto\/([a-f0-9]{12,40})/i.exec(pathOrUrl);
  return m ? m[1].toLowerCase() : null;
}

/** Normaliza el enlace de la oferta a una URL abrible. */
export function resolveLink(link: unknown): string | null {
  if (typeof link !== "string" || !link.trim()) return null;
  const l = link.trim();
  if (/^https?:\/\//i.test(l) || /^[a-z][a-z0-9+.-]*:/i.test(l)) return l;
  // Ruta relativa (p.ej. "/bubui/n/...") → la resolvemos contra el Hub.
  return `${API_BASE}${l.startsWith("/") ? "" : "/"}${l}`;
}

/** Abre el enlace de la oferta si es válido. No-op si no lo es. */
export function openLink(link: unknown): void {
  const url = resolveLink(link);
  if (url) Linking.openURL(url).catch(() => {});
}
