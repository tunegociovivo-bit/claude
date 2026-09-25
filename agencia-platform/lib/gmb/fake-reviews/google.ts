/**
 * Caso para Google: reseñas cuya retirada se solicita, con la evidencia y la política aplicable.
 *  A) Perfiles con patrón claro: negativa al cliente + positiva a la competencia (interacción falsa /
 *     conflicto de intereses), con riesgo medio o alto.
 *  B) Reseñas que incumplen la política de contenido (insultos, lenguaje soez, datos personales…).
 * También genera el escrito a soporte de Google (IA con plantilla de respaldo).
 */
import { LEVEL_MEDIUM, type AnalysisResults, type Author } from "./analyzer";
import { POLICY_CATEGORIES, type PolicyFinding } from "./policy";

export type RemovalItem = {
  reviewId: string;
  author: string;
  authorLink: string;
  rating: number;
  date: string;
  text: string;
  link: string;
  reasons: string[];
  policies: string[];
};

export type GoogleCase = { fakeProfiles: Author[]; policyReviews: PolicyFinding[]; removals: RemovalItem[] };

const FAKE_POLICY = "Contenido falso / interacción falsa (Fake engagement) y conflicto de intereses";

export function buildGoogleCase(res: AnalysisResults): GoogleCase {
  const fakeProfiles = res.authors.filter((a) => a.crossPos > 0 && a.score >= LEVEL_MEDIUM);
  const policyReviews = (res.policy?.findings ?? []).filter((f) => f.likelihood !== "baja");
  const map = new Map<string, RemovalItem>();
  const keyOf = (id: string, link: string, author: string, date: string) => id || link || `${author}|${date}`;

  for (const a of fakeProfiles) {
    const comp = a.compReviews
      .filter((c) => c.rating >= (res.params.posThreshold ?? 4))
      .map((c) => `${res.competitors[c.comp ?? 0]?.title ?? c.title ?? "competidor"} (${c.rating}/5, ${c.date})`)
      .join("; ");
    for (const r of a.clientReviews) {
      const k = keyOf(r.reviewId ?? "", r.link, a.name, r.date);
      const item = map.get(k) ?? { reviewId: r.reviewId ?? "", author: a.name, authorLink: a.link, rating: r.rating, date: r.date, text: r.text, link: r.link, reasons: [], policies: [] };
      item.reasons.push(
        `El mismo perfil publicó valoraciones positivas en negocios competidores: ${comp}` +
          (a.gapDays != null ? ` (${a.gapDays} días entre ambas reseñas)` : "") +
          `. Puntuación de riesgo ${a.score}/100.`
      );
      if (!item.policies.includes(FAKE_POLICY)) item.policies.push(FAKE_POLICY);
      map.set(k, item);
    }
  }
  for (const f of policyReviews) {
    const k = keyOf(f.reviewId, f.link, f.author, f.date);
    const item = map.get(k) ?? { reviewId: f.reviewId, author: f.author, authorLink: f.authorLink, rating: f.rating, date: f.date, text: f.text, link: f.link, reasons: [], policies: [] };
    for (const v of f.violations) {
      item.reasons.push(`${POLICY_CATEGORIES[v.category].label}: «${v.evidence}» — ${v.explanation}`);
      const pol = POLICY_CATEGORIES[v.category].google;
      if (!item.policies.includes(pol)) item.policies.push(pol);
    }
    map.set(k, item);
  }
  return { fakeProfiles, policyReviews, removals: [...map.values()] };
}

/* ───────────────────────── Escrito a soporte ───────────────────────── */

export const LETTER_SYSTEM = `Eres responsable de reputación online de una agencia de marketing y redactas en español escritos formales dirigidos al equipo de soporte del Perfil de Empresa de Google (Google Business Profile) para solicitar la retirada de reseñas que incumplen las políticas de contenido de Google Maps.
Reglas:
- Tono formal, claro y objetivo. Nada de acusaciones que no estén respaldadas por los datos: habla de "patrón", "indicios" y "incumplimiento de la política".
- Estructura: asunto; saludo; identificación del negocio (nombre, dirección, enlace de Maps) y de quien escribe (agencia gestora en nombre del titular); resumen del problema con cifras; bloque A (perfiles con patrón de interacción falsa: valoran negativamente al negocio y positivamente a competidores directos, a menudo en fechas próximas); bloque B (reseñas con contenido prohibido: insultos, lenguaje soez, datos personales, conflicto de intereses, etc.); para CADA reseña: autor, fecha, estrellas, enlace, motivo concreto y política de Google aplicable; solicitud expresa de revisión y retirada; ofrecimiento de información adicional; despedida y firma con los datos facilitados.
- Cita las políticas por su nombre oficial (p. ej. "Contenido falso e interacción falsa", "Conflicto de intereses", "Acoso", "Contenido ofensivo", "Información personal", "Incitación al odio").
- Texto plano (sin markdown, sin tablas). Usa listas numeradas simples para las reseñas.`;

export function letterUserPrompt(res: AnalysisResults, gc: GoogleCase, signer: { agency: string; contact?: string }): string {
  const data = {
    negocio: { nombre: res.client.title, direccion: res.client.address, enlace_maps: res.client.mapsUrl, place_id: res.client.placeId || undefined, nota: res.client.rating, reseñas: res.client.reviews },
    competidores: res.competitors.map((c) => c.title),
    resumen: {
      negativas_analizadas: res.stats.clientNeg,
      perfiles_patron: gc.fakeProfiles.length,
      reseñas_contenido_prohibido: gc.policyReviews.length,
      total_reseñas_a_retirar: gc.removals.length
    },
    reseñas: gc.removals.map((r, i) => ({ n: i + 1, autor: r.author, perfil: r.authorLink, fecha: r.date, estrellas: r.rating, enlace: r.link, texto: r.text.slice(0, 300), motivos: r.reasons, politicas: r.policies }))
  };
  return `Redacta el escrito con estos datos (JSON). Firma: ${signer.agency}${signer.contact ? `, ${signer.contact}` : ""}, en nombre del titular del negocio.\n\n${JSON.stringify(data)}`;
}

/** Plantilla sin IA (respaldo). */
export function fallbackLetter(res: AnalysisResults, gc: GoogleCase, signer: { agency: string; contact?: string }): string {
  const today = new Date().toLocaleDateString("es-ES");
  const lines: string[] = [];
  lines.push(`Asunto: Solicitud de revisión y retirada de ${gc.removals.length} reseñas que incumplen las políticas de Google Maps — ${res.client.title}`);
  lines.push("");
  lines.push("Estimado equipo de soporte de Google Business Profile:");
  lines.push("");
  lines.push(
    `Nos dirigimos a ustedes, como agencia gestora del Perfil de Empresa «${res.client.title}»${res.client.address ? ` (${res.client.address})` : ""}, en nombre de su titular, para solicitar la revisión de las reseñas que se detallan a continuación. Enlace de la ficha: ${res.client.mapsUrl}`
  );
  lines.push("");
  lines.push(
    `Tras analizar ${res.stats.clientNeg} reseñas negativas recientes, hemos identificado ${gc.fakeProfiles.length} perfiles con un patrón compatible con interacción falsa (valoran negativamente a este negocio y, en fechas próximas, positivamente a competidores directos de la zona) y ${gc.policyReviews.length} reseñas cuyo contenido incumple la política de contenido prohibido y restringido de Google Maps.`
  );
  lines.push("");
  lines.push("Reseñas cuya retirada solicitamos:");
  gc.removals.forEach((r, i) => {
    lines.push("");
    lines.push(`${i + 1}. Autor: ${r.author}${r.authorLink ? ` (${r.authorLink})` : ""} — ${r.rating}/5 — ${r.date}`);
    if (r.link) lines.push(`   Enlace: ${r.link}`);
    if (r.text) lines.push(`   Texto: «${r.text.slice(0, 300)}${r.text.length > 300 ? "…" : ""}»`);
    lines.push(`   Política incumplida: ${r.policies.join("; ")}`);
    for (const m of r.reasons) lines.push(`   Motivo: ${m}`);
  });
  lines.push("");
  lines.push(
    "Estas reseñas no reflejan experiencias reales con el negocio o incumplen las normas de contenido de Google, y distorsionan la valoración que ven los usuarios. Les rogamos que las revisen y, en su caso, procedan a su retirada. Quedamos a su disposición para aportar cualquier información adicional."
  );
  lines.push("");
  lines.push("Atentamente,");
  lines.push(signer.agency);
  if (signer.contact) lines.push(signer.contact);
  lines.push(today);
  return lines.join("\n");
}
