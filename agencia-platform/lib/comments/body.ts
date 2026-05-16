/**
 * Helpers para normalizar el body de un Comment. Hay dos formatos
 * conviviendo:
 *
 *   - String legacy: texto plano (importado de Asana, comentarios
 *     antiguos pre-TipTap) o JSON stringified de TipTap.
 *   - Json TipTap (bodyJson): el doc completo con marks, images,
 *     mentions, etc.
 *
 * `toTipTapDoc(body)` siempre devuelve un doc válido. `extractText`
 * devuelve texto plano para indexar o resumir. `serializeForString`
 * devuelve un string apto para persistir en la columna `body` (sigue
 * siendo NOT NULL).
 */

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;

export function toTipTapDoc(body: unknown): any {
  if (!body) return { ...EMPTY_DOC };
  if (typeof body === "object") {
    // Asumimos que ya es un doc TipTap.
    if ((body as any).type === "doc") return body;
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  if (typeof body !== "string") return { ...EMPTY_DOC };
  const trimmed = body.trim();
  if (!trimmed) return { ...EMPTY_DOC };
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed);
      if (j && j.type === "doc" && Array.isArray(j.content)) return j;
    } catch {
      // pasa al fallback de texto plano
    }
  }
  // Texto plano → doc con un párrafo por línea no vacía.
  const lines = trimmed.split(/\n+/).filter(Boolean);
  return {
    type: "doc",
    content: lines.length
      ? lines.map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] }))
      : [{ type: "paragraph" }]
  };
}

export function extractText(body: unknown): string {
  const doc = toTipTapDoc(body);
  const out: string[] = [];
  function visit(n: any) {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    if (n.type === "mention" && n.attrs?.label) out.push(`@${n.attrs.label}`);
    if (Array.isArray(n.content)) visit(n.content);
  }
  visit(doc);
  return out.join(" ").trim();
}

/**
 * Para persistir en la columna `body` (NOT NULL). Si el caller pasa
 * un doc TipTap, lo serializamos. Si pasa string, lo dejamos tal cual.
 */
export function serializeForString(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}
