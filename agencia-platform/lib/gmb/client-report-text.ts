/**
 * Textos automáticos del informe de ficha (resumen y próximos pasos) en modo «real» o «cliente».
 * Puro (sin dependencias de servidor): lo usan la página del informe y el PDF.
 * El modo cliente nunca altera cifras: solo elige qué contar y cómo.
 */
export type ReportMode = "real" | "cliente";
type Mode = ReportMode;
export type Line = { text: string; tone: "good" | "bad" | "neutral" };

const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "–" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const nf = new Intl.NumberFormat("es-ES");
export const pct = (now: number, prev: number) => (prev > 0 ? ((now - prev) / prev) * 100 : now > 0 ? null : 0);

export function conversion(data: any) {
  const perf = data.performance?.ok ? data.performance : null;
  return {
    conv: perf && perf.views ? (perf.interactions / perf.views) * 100 : null,
    prevConv: perf && perf.prevViews ? (perf.prevInteractions / perf.prevViews) * 100 : null,
    comparable: !!perf?.prevRange?.complete
  };
}

export function buildSummary(data: any, mode: Mode, x: { conv: number | null; prevConv: number | null; comparable: boolean }): Line[] {
  const real = mode === "real";
  const perf = data.performance?.ok ? data.performance : null;
  const rv = data.reviews;
  const out: Line[] = [];
  const change = (label: string, now: number, prev: number, unit = "") => {
    if (!x.comparable) return;
    const d = pct(now, prev);
    if (d === null) {
      out.push({ text: `${label}: ${fmt(now)}${unit} (sin actividad en el periodo anterior).`, tone: "good" });
      return;
    }
    if (d > 0) out.push({ text: `${label} crecen un ${fmt(d, d < 10 ? 1 : 0)}%: ${fmt(now)}${unit} frente a ${fmt(prev)}.`, tone: "good" });
    else if (d < 0 && real) out.push({ text: `${label} bajan un ${fmt(-d, -d < 10 ? 1 : 0)}%: ${fmt(now)}${unit} frente a ${fmt(prev)}.`, tone: "bad" });
    else if (d === 0 && real) out.push({ text: `${label} se mantienen estables (${fmt(now)}${unit}).`, tone: "neutral" });
  };
  if (perf) {
    if (!real || !x.comparable) out.push({ text: `La ficha apareció ${fmt(perf.views)} veces en Google y generó ${fmt(perf.interactions)} acciones de clientes (llamadas, rutas, visitas a la web…).`, tone: "good" });
    change("Las visualizaciones", perf.views, perf.prevViews);
    change("Las interacciones", perf.interactions, perf.prevInteractions);
    change("Las llamadas", perf.totals.CALL_CLICKS ?? 0, perf.prevTotals.CALL_CLICKS ?? 0);
    change("Las solicitudes de cómo llegar", perf.totals.BUSINESS_DIRECTION_REQUESTS ?? 0, perf.prevTotals.BUSINESS_DIRECTION_REQUESTS ?? 0);
    change("Los clics a la web", perf.totals.WEBSITE_CLICKS ?? 0, perf.prevTotals.WEBSITE_CLICKS ?? 0);
    if (x.conv != null && x.prevConv != null && x.comparable && (real || x.conv > x.prevConv))
      out.push({ text: `Tasa de interacción del ${fmt(x.conv, 1)}% (antes ${fmt(x.prevConv, 1)}%): ${x.conv >= x.prevConv ? "cada visita convierte mejor" : "convierten menos visitas"}.`, tone: x.conv >= x.prevConv ? "good" : "bad" });
    if (perf.keywords[0]) out.push({ text: `La búsqueda que más clientes trae es «${perf.keywords[0].keyword}» (${perf.keywords[0].impressions != null ? fmt(perf.keywords[0].impressions) : "<15"} veces).`, tone: "good" });
  } else if (real) {
    out.push({ text: "No hay datos de rendimiento de Google para este periodo.", tone: "bad" });
  }
  const p = rv.period;
  if (p.total) {
    const showAvg = real || p.avg >= Math.min(4.5, rv.overall.avg);
    out.push({
      text: `${p.total} ${p.total === 1 ? "reseña nueva" : "reseñas nuevas"}${showAvg ? ` con una media de ${fmt(p.avg, 1)}★` : ""}${p.positive ? ` (${p.positive} de 4-5 estrellas)` : ""}.`,
      tone: p.avg >= 4 ? "good" : real ? "bad" : "neutral"
    });
  } else if (real) out.push({ text: "No llegaron reseñas nuevas en el periodo.", tone: "bad" });
  if (real && p.negative) out.push({ text: `${p.negative} ${p.negative === 1 ? "reseña negativa" : "reseñas negativas"} (1-2★) en el periodo.`, tone: "bad" });
  if (real && p.unreplied) out.push({ text: `${p.unreplied} ${p.unreplied === 1 ? "reseña del periodo sigue" : "reseñas del periodo siguen"} sin responder.`, tone: "bad" });
  if (!real && p.total && p.responseRate >= 60) out.push({ text: `Se ha respondido al ${p.responseRate}% de las reseñas: el negocio cuida a sus clientes.`, tone: "good" });
  if (data.posts.count) out.push({ text: `${data.posts.count} publicaciones en Google para mantener la ficha activa.`, tone: "good" });
  else if (real) out.push({ text: "No se publicó nada en la ficha durante el periodo.", tone: "bad" });
  if (!real && data.client.rating) out.push({ text: `Valoración global de ${fmt(data.client.rating, 1)}★ con ${nf.format(data.client.reviewCount)} opiniones.`, tone: "good" });
  const fk = data.fake;
  if (fk) {
    const st = fk.stats;
    const imp = fk.impact;
    if (real) {
      out.push({
        text: `Análisis de reseñas falsas (${new Date(fk.date).toLocaleDateString("es-ES")}): ${st.high} perfiles de riesgo alto y ${st.medium} de riesgo medio; ${st.removable} reseñas incumplen las políticas de Google (${st.removableHigh} con probabilidad alta de retirada).`,
        tone: st.high + st.removable > 0 ? "bad" : "good"
      });
      if (imp && imp.removed > 0) out.push({ text: `Sin las ${imp.removed} reseñas sospechosas la valoración pasaría de ${fmt(imp.current, 1)}★ a ${fmt(imp.without, 1)}★.`, tone: "neutral" });
      if (st.networks) out.push({ text: `Detectadas ${st.networks} redes de perfiles que reseñan los mismos negocios en fechas próximas.`, tone: "bad" });
    } else if (st.removable + st.high > 0) {
      out.push({
        text: `Protección de reputación: hemos identificado ${st.removable || st.high} reseñas que incumplen las políticas de Google o proceden de perfiles sospechosos, y gestionamos su retirada.`,
        tone: "good"
      });
      if (imp && imp.without > imp.current) out.push({ text: `Su retirada podría elevar la valoración de ${fmt(imp.current, 1)}★ a ${fmt(imp.without, 1)}★.`, tone: "good" });
    }
  } else if (fk === null && real) {
    out.push({ text: "No hay ningún análisis de reseñas falsas terminado para esta ficha (lánzalo en la pestaña «Reseñas falsas»).", tone: "neutral" });
  }
  return out.length ? out : [{ text: "Periodo sin actividad registrable.", tone: "neutral" }];
}

export function buildNextSteps(data: any, mode: Mode, x: { conv: number | null; prevConv: number | null; comparable: boolean }): string[] {
  const perf = data.performance?.ok ? data.performance : null;
  const p = data.reviews.period;
  if (mode === "cliente") {
    const s = [
      "Seguir publicando novedades y ofertas en la ficha para mantener la visibilidad.",
      "Impulsar la captación de reseñas con el enlace y el código QR de valoración.",
      "Responder a todas las reseñas para reforzar la confianza de los nuevos clientes."
    ];
    if (data.fake?.stats?.removable) s.unshift("Solicitar a Google la retirada de las reseñas que incumplen sus políticas y vigilar nuevas reseñas sospechosas.");
    if (perf?.keywords?.[1]) s.unshift(`Reforzar la presencia en búsquedas como «${perf.keywords[0].keyword}» y «${perf.keywords[1].keyword}».`);
    return s;
  }
  const s: string[] = [];
  if (perf && x.comparable) {
    const dv = pct(perf.views, perf.prevViews);
    const di = pct(perf.interactions, perf.prevInteractions);
    if (dv != null && dv < -10) s.push(`Caída de visibilidad del ${fmt(-dv)}%: revisar categorías, publicaciones y fotos; comprobar el ranking de la palabra clave principal.`);
    if (di != null && di < -10) s.push(`Las interacciones bajan un ${fmt(-di)}%: revisar horario, teléfono, web y botón de reserva.`);
    if (x.conv != null && x.prevConv != null && x.conv < x.prevConv) s.push("La tasa de interacción empeora: mejorar fotos, descripción y ofertas para convertir más visitas.");
  }
  if (p.unreplied) s.push(p.unreplied === 1 ? "Responder la reseña pendiente del periodo." : `Responder las ${p.unreplied} reseñas pendientes del periodo.`);
  if (p.negative) s.push(`Gestionar ${p.negative === 1 ? "la reseña negativa" : `las ${p.negative} reseñas negativas`} (respuesta y, si procede, revisión de posibles falsas).`);
  if (p.total < 3) s.push("Pocas reseñas nuevas: activar el enlace de reseñas con los clientes recientes.");
  if (!data.posts.count) s.push("Publicar al menos 1 novedad por semana en la ficha.");
  if (!perf) s.push("Revisar la conexión con Google: no se obtuvieron datos de rendimiento.");
  if (data.fake?.stats?.removable) s.push(`Denunciar a Google las ${data.fake.stats.removable} reseñas que incumplen sus políticas (empezando por las ${data.fake.stats.removableHigh} de probabilidad alta).`);
  if (data.fake?.stats?.high) s.push(`Reunir evidencias de los ${data.fake.stats.high} perfiles de riesgo alto y abrir caso de soporte con Google.`);
  if (!s.length) s.push("Sin incidencias: mantener el ritmo de publicaciones y reseñas.");
  return s;
}
