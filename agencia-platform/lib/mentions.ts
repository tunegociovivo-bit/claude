/**
 * Parser muy ligero de @menciones en texto plano.
 * Sintaxis aceptada: @<token> donde <token> coincide con un email del workspace.
 * Ejemplos:
 *   "Oye @lucia@negociovivo.com revisa esto" → ["lucia@negociovivo.com"]
 *   "Hola @lucia y @pedro@x.com"             → ["lucia", "pedro@x.com"]
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
    const match = workspaceUsers.find((u) =>
      hasDomain ? u.email.toLowerCase() === lower : u.email.toLowerCase().split("@")[0] === lower
    );
    if (match && !result.some((r) => r.id === match.id)) result.push(match);
  }
  return result;
}
