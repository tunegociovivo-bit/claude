/**
 * Evaluación de aprobaciones REUTILIZABLES (Slice 2c) — puro. Una acción sensible
 * (A4 / supera límites) solo procede si existe una aprobación viva que la cubra.
 * NUNCA hay aprobación implícita: sin coincidencia → no aprobado.
 */
export type ApprovalRecord = {
  id: string;
  action: string; // acción o patrón (glob simple con "*")
  scope?: string | null; // p.ej. clientId, o "*"
  sensitive?: boolean; // A4: política estricta de cobertura
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
  /** ¿Es una acción SENSIBLE (A4: mensajes/pagos/publicaciones/fiscal/…)? Si lo es,
   *  se aplica la política estricta: ninguna aprobación con comodines amplios o topes
   *  nulos puede cubrirla (fail-closed reforzado). */
  sensitive?: boolean;
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
    // POLÍTICA ESTRICTA para acciones SENSIBLES (A4): una aprobación demasiado amplia
    // NO puede autorizarlas, aunque coincida por glob. Cierra el fail-open de la
    // *definición* de la aprobación (comodines / topes nulos).
    if (req.sensitive) {
      if (a.action === "*") continue; // acción exacta o prefijo acotado, nunca "*"
      if (!a.scope || a.scope === "*") continue; // scope específico obligatorio
      // Si la petición conlleva importe/volumen, DEBE haber tope numérico (no null).
      if (typeof req.amountCents === "number" && typeof a.maxAmountCents !== "number") continue;
      if (typeof req.volume === "number" && typeof a.maxVolume !== "number") continue;
    }
    // FAIL-CLOSED: si la aprobación tiene tope de importe/volumen, la petición DEBE
    // traer una cantidad numérica que quepa. Sin cantidad conocida → NO cubierta
    // (una acción sensible sin importe no debe colarse bajo una aprobación con tope).
    if (typeof a.maxAmountCents === "number" && !(typeof req.amountCents === "number" && req.amountCents <= a.maxAmountCents)) continue;
    if (typeof a.maxVolume === "number" && !(typeof req.volume === "number" && req.volume <= a.maxVolume)) continue;
    return { approved: true, matchedId: a.id, reason: `Cubierta por aprobación ${a.id}` };
  }
  return { approved: false, matchedId: null, reason: "Sin aprobación viva que cubra la acción" };
}

export type GrantValidation = { ok: true } | { ok: false; error: string };

/**
 * Valida una solicitud de GRANT (usada por el endpoint admin). Rechaza aprobaciones
 * peligrosamente amplias: comodín total de acción, scope amplio, o topes nulos para
 * acciones sensibles. Exige TTL (caducidad) y un motivo. Pura y determinista.
 */
export function validateApprovalGrant(input: {
  action?: string | null;
  scope?: string | null;
  maxAmountCents?: number | null;
  maxVolume?: number | null;
  expiresAt?: Date | string | null;
  reason?: string | null;
  sensitive?: boolean;
}): GrantValidation {
  const action = (input.action ?? "").trim();
  if (!action) return { ok: false, error: "action requerida" };
  if (action === "*") return { ok: false, error: "no se permite el comodín total de acción ('*')" };
  if (!input.reason || !input.reason.trim()) return { ok: false, error: "motivo (reason) requerido para auditoría" };
  const exp = ms(input.expiresAt ?? null);
  if (exp == null) return { ok: false, error: "caducidad (expiresAt) obligatoria: no hay aprobaciones eternas" };
  for (const [k, v] of [["maxAmountCents", input.maxAmountCents], ["maxVolume", input.maxVolume]] as const) {
    if (v != null && (!Number.isFinite(v) || (v as number) < 0)) return { ok: false, error: `${k} inválido` };
  }
  if (input.sensitive) {
    const scope = (input.scope ?? "").trim();
    if (!scope || scope === "*") return { ok: false, error: "acción sensible: scope específico obligatorio (no '*')" };
    if (action.endsWith(".*")) return { ok: false, error: "acción sensible: no se permiten prefijos comodín" };
  }
  return { ok: true };
}
