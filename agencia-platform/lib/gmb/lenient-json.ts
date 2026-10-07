/**
 * Make construye el JSON por texto: si el comentario o el nombre traen comillas o saltos de
 * línea, el JSON llega roto. Se intenta parsear normal y, si falla, se recupera el comentario
 * (último campo) y se escapan saltos de línea.
 */
export function parseLenient(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* sigue */
  }
  const fixed = text.replace(/\r?\n/g, "\\n");
  try {
    return JSON.parse(fixed);
  } catch {
    /* sigue */
  }
  const m = fixed.match(/"comment"\s*:\s*"([\s\S]*)"\s*}\s*$/);
  if (!m) return null;
  const head = fixed.slice(0, m.index) + '"comment":""}';
  try {
    const obj = JSON.parse(head);
    obj.comment = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    return obj;
  } catch {
    return null;
  }
}
