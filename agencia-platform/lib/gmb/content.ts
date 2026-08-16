/**
 * Contenido GBP — generadores PUROS de BORRADORES (novedades/ofertas/eventos) a partir de la
 * categoría de la ficha. No publica nada: produce borradores auditables que pasan por aprobación y
 * programación. Determinista (plantillas), sin red; el AI Council puede enriquecer aparte.
 */
export type PostType = "update" | "offer" | "event";
export type ContentDraft = { type: PostType; title: string; content: string; cta: string };

const CTA_BY_TYPE: Record<PostType, string> = { update: "Más información", offer: "Ver oferta", event: "Reservar" };

/** Ideas de contenido base por categoría. Borradores editables antes de programar. */
export function contentIdeas(opts: { category?: string | null; name?: string | null; keyword?: string | null }): ContentDraft[] {
  const cat = (opts.category ?? "tu negocio").trim() || "tu negocio";
  const kw = (opts.keyword ?? cat).trim();
  const name = (opts.name ?? "").trim();
  const who = name ? `en ${name}` : "";
  return [
    { type: "update", title: `Novedades de ${cat}`, content: `Cuenta una novedad reciente ${who}: nuevo servicio, mejora o algo que os diferencia en ${kw}. Incluye una foto real.`, cta: CTA_BY_TYPE.update },
    { type: "offer", title: `Oferta especial`, content: `Publica una promoción por tiempo limitado ${who}. Indica condiciones y fecha de fin para crear urgencia.`, cta: CTA_BY_TYPE.offer },
    { type: "event", title: `Evento o jornada`, content: `Anuncia un evento, taller o jornada de puertas abiertas ${who}. Añade fecha, hora y cómo apuntarse.`, cta: CTA_BY_TYPE.event },
    { type: "update", title: `Reseña destacada`, content: `Comparte una reseña positiva reciente y agradece a la clientela. Refuerza la confianza local en ${kw}.`, cta: CTA_BY_TYPE.update }
  ];
}

export type CadenceHealth = { status: "good" | "low" | "none"; postsLast30: number; target: number; message: string };

/** Salud de la cadencia de publicación (objetivo 4/mes). */
export function cadenceHealth(postsLast30: number, target = 4): CadenceHealth {
  if (postsLast30 <= 0) return { status: "none", postsLast30, target, message: "Sin publicaciones en 30 días. Programa al menos 1/semana." };
  if (postsLast30 < target) return { status: "low", postsLast30, target, message: `Cadencia baja (${postsLast30}/${target}). Programa más novedades.` };
  return { status: "good", postsLast30, target, message: "Buena cadencia de publicación." };
}
