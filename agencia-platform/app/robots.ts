import type { MetadataRoute } from "next";

/**
 * Plataforma interna privada: bloqueamos por completo el rastreo en
 * cualquier motor de búsqueda. Genera /robots.txt con "Disallow: /"
 * para todos los user-agents. Reforzado con la metadata `robots`
 * (meta noindex) del layout y la cabecera HTTP X-Robots-Tag en
 * next.config.js.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/"
      }
    ]
  };
}
