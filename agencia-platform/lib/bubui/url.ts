/**
 * URLs públicas de Bubui — dominio único y rutas "bonitas".
 *
 * Dominio: NEXT_PUBLIC_BUBUI_URL (p. ej. https://bubui.app). El middleware
 * reescribe en bubui.app:
 *   /            → informativa
 *   /registro    → alta de comercios
 *   /negocios    → panel del comercio   (interno /bubui/negocio)
 *   /usuarios    → app de clientes       (interno /bubui/app)
 *
 * Usa SIEMPRE estas constantes/este helper para enlaces que se envían o
 * imprimen (WhatsApp, email, QR, Stripe), así no quedan atados al dominio
 * desde el que se generó la petición.
 */

export function bubuiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BUBUI_URL || "https://bubui.app").replace(/\/+$/, "");
}

/** Rutas públicas canónicas de Bubui. */
export const BUBUI_PATHS = {
  home: "/",
  registro: "/registro",
  negocios: "/negocios",
  usuarios: "/usuarios"
} as const;

/** Construye una URL absoluta de Bubui a partir de una ruta limpia. */
export function bubuiUrl(path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${bubuiBaseUrl()}${p}`;
}
