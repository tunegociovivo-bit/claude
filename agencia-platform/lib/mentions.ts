/**
 * Parser de @menciones para los dos formatos que coexisten:
 *  1. Texto plano legacy (`@lucia`, `@lucia@dominio.com`) — se sigue
 *     resolviendo contra emails del workspace.
 *  2. JSON de TipTap (formato nuevo) — el editor inserta nodos
 *     `{ type: "mention", attrs: { id: <userId>, label: <nombre> } }`.
 *     De estos extraemos directamente `attrs.id`, así no hay que
 *     adivinar nada por el label.
 */

const MENTION_RE = /@([a-zA-Z0-9._%+-]+(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?)/g;

export function extractMentionTokens(body: string): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body)) !== null) {
    set.add(m[1]);
  }
  return Array.from(set);
}

/**
 * Extrae userIds de los nodos `mention` de un doc TipTap. Si el body
 * no parsea como JSON con `type: "doc"` devuelve []. Recorre el árbol
 * de `content` recursivamente.
 */
export function extractMentionUserIds(body: string): string[] {
  if (!body) return [];
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return [];
  let doc: any;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return [];
  const ids = new Set<string>();
  const stack: any[] = [...doc.content];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (n.type === "mention" && n.attrs?.id) ids.add(String(n.attrs.id));
    if (Array.isArray(n.content)) stack.push(...n.content);
  }
  return Array.from(ids);
}

/**
 * Resuelve tokens contra una lista de usuarios. Match por email exacto
 * o por inicio de email (sin dominio). Devuelve los users encontrados.
 */
export function resolveMentions<T extends { id: string; email: string; name: string | null }>(
  tokens: string[],
  workspaceUsers: T[]
): T[] {
  const result: T[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const hasDomain = lower.includes("@");
    const normalizedToken = normalizeMentionKey(token);
    const match = workspaceUsers.find((u) => {
      if (hasDomain) return u.email.toLowerCase() === lower;
      const emailLocal = u.email.toLowerCase().split("@")[0];
      const nameKey = normalizeMentionKey(u.name ?? "");
      const compactToken = normalizedToken.replace(/\./g, "");
      const compactName = nameKey.replace(/\./g, "");
      const compactEmail = normalizeMentionKey(emailLocal).replace(/\./g, "");
      return (
        emailLocal === lower ||
        normalizeMentionKey(emailLocal) === normalizedToken ||
        compactEmail === compactToken ||
        (!!nameKey && nameKey === normalizedToken) ||
        (!!compactName && compactName === compactToken) ||
        (!!compactName && compactName.startsWith(compactToken)) ||
        (!!nameKey && nameKey.split(".").includes(normalizedToken))
      );
    });
    if (match && !result.some((r) => r.id === match.id)) result.push(match);
  }
  return result;
}

function normalizeMentionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".");
}
