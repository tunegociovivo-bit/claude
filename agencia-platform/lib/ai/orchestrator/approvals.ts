/**
 * Evaluación de aprobaciones REUTILIZABLES (Slice 2c) — puro. Una acción sensible
 * (A4 / supera límites) solo procede si existe una aprobación viva que la cubra.
 * NUNCA hay aprobación implícita: sin coincidencia → no aprobado.
 */
export type ApprovalRecord = {
  id: string;
  action: string; // acción o patrón (glob simple con "*")
  scope?: string | null; // p.ej. clientId, o "*"
  maxAmountCents?: number | null; // techo de importe (null = sin techo → cuidado)
  maxVolume?: number | null; // techo de volumen
  remaining?: number | null; // usos restantes (null = ilimitado dentro de límites)
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
};

export type ApprovalRequest = {
  action: string;
  scope?: string | null;
  amountCents?: number | null;
  volume?: number | null;
};

export type ApprovalResult = { approved: boolean; matchedId: string | null; reason: string };

const ms = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

/** ¿La aprobación está viva (no revocada, no caducada, con usos)? */
export function isApprovalLive(a: ApprovalRecord, now: Date): boolean {
  if (ms(a.revokedAt) != null) return false;
  const exp = ms(a.expiresAt);
  if (exp != null && exp <= now.getTime()) return false;
  if (typeof a.remaining === "number" && a.remaining <= 0) return false;
  return true;
}

/** Glob muy simple: "a.*" cubre "a.b"; "*" cubre todo; exacto en otro caso. */
export function actionMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return action === pattern.slice(0, -2) || action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

function scopeMatches(approvalScope: string | null | undefined, reqScope: string | null | undefined): boolean {
  if (!approvalScope || approvalScope === "*") return true; // aprobación amplia
  return approvalScope === reqScope;
}

/**
 * Evalúa una petición contra las aprobaciones. Determinista. Devuelve la primera
 * coincidencia viva que cubre acción, scope, importe y volumen. Sin coincidencia
 * → { approved:false } (nunca implícito).
 */
export function evaluateApproval(approvals: ApprovalRecord[], req: ApprovalRequest, now: Date): ApprovalResult {
  for (const a of approvals) {
    if (!isApprovalLive(a, now)) continue;
    if (!actionMatches(a.action, req.action)) continue;
    if (!scopeMatches(a.scope, req.scope)) continue;
    if (typeof a.maxAmountCents === "number" && typeof req.amountCents === "number" && req.amountCents > a.maxAmountCents) continue;
    if (typeof a.maxVolume === "number" && typeof req.volume === "number" && req.volume > a.maxVolume) continue;
    return { approved: true, matchedId: a.id, reason: `Cubierta por aprobación ${a.id}` };
  }
  return { approved: false, matchedId: null, reason: "Sin aprobación viva que cubra la acción" };
}
