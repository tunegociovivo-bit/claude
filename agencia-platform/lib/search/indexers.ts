/**
 * Constructores de "documento de texto" por entidad para alimentar
 * al embedder. Concentramos la lógica aquí para que cuando se cambia
 * qué campos se indexan, se haga en un solo sitio y los hooks de
 * los endpoints no se ensucien.
 *
 * Idea: lo que metas aquí es lo que se podrá encontrar buscando por
 * significado. No incluyas datos sensibles (mrr, accesos, secrets).
 */

import { tipTapToText } from "./embeddings";

export function textForTask(t: {
  title: string;
  description?: string | null;
}): string {
  const parts: string[] = [];
  if (t.title) parts.push(t.title);
  if (t.description) parts.push(tipTapToText(t.description));
  return parts.join("\n\n");
}

export function textForClient(c: {
  name: string;
  industry?: string | null;
  notes?: string | null;
  infoGeneral?: string | null;
  brandBrief?: string | null;
  website?: string | null;
  contactName?: string | null;
}): string {
  const parts: string[] = [];
  if (c.name) parts.push(c.name);
  if (c.industry) parts.push(`Sector: ${c.industry}`);
  if (c.contactName) parts.push(`Contacto: ${c.contactName}`);
  if (c.website) parts.push(c.website);
  if (c.infoGeneral) parts.push(c.infoGeneral);
  if (c.brandBrief) parts.push(c.brandBrief);
  if (c.notes) parts.push(c.notes);
  // Importante: NO incluimos mrr ni accesos ni passwords.
  return parts.join("\n\n");
}

export function textForProject(p: {
  name: string;
  description?: string | null;
}): string {
  return [p.name, p.description].filter(Boolean).join("\n\n");
}

export function textForDocument(d: { title: string; content?: any }): string {
  return [d.title, d.content ? tipTapToText(d.content) : null].filter(Boolean).join("\n\n");
}

// `body` lo dejamos `unknown` para que el caller pueda pasar tanto
// el campo `body` (String) como `bodyJson` (Prisma.JsonValue) sin
// hacer casts. tipTapToText() ya distingue ambos casos.
export function textForComment(c: { body: unknown }): string {
  return tipTapToText(c.body);
}
