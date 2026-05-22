/**
 * Guardián anti-bloqueo para la Graph/Marketing API de Meta.
 *
 * Objetivo: que nuestra automatización NUNCA machaque a Meta y, por tanto,
 * nunca provoque un bloqueo de la cuenta. Tres mecanismos:
 *
 *  1) Lectura de cabeceras de uso (`x-business-use-case-usage`,
 *     `x-app-usage`, `x-ad-account-usage`). Meta nos dice el % de cuota
 *     consumida; si nos acercamos al límite, frenamos.
 *  2) Cortafuegos (circuit breaker): ante un rate-limit/bloqueo, entramos
 *     en enfriamiento y dejamos de escribir hasta que pase (respetando el
 *     `estimated_time_to_regain_access` si Meta lo indica). Fail-fast en vez
 *     de reintentar (reintentar agrava el bloqueo).
 *  3) Serialización + espaciado de las ESCRITURAS: nunca lanzamos ráfagas;
 *     cada escritura va espaciada de la anterior.
 *
 * Estado en memoria de proceso (Railway corre Node persistente). Si el
 * proceso reinicia, se resetea — es aceptable: el enfriamiento de Meta dura
 * minutos/horas y un reinicio no provoca por sí mismo un bloqueo.
 */

import { prisma } from "@/lib/db/prisma";

const GUARD_ID = "global";
const MIN_WRITE_GAP_MS = 1500; // separación mínima entre escrituras
const HIGH_USAGE_PCT = 75; // a partir de aquí, backoff extra
const HIGH_USAGE_BACKOFF_MS = 3000;
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min si Meta no dice cuánto

let cooldownUntil = 0;
let cooldownReason = "";
let lastUsagePct = 0;
let lastWriteStart = 0;
let writeChain: Promise<void> = Promise.resolve();
let loadedFromDb = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Carga (una vez por proceso) el enfriamiento persistido en BD, para que
 *  un reinicio no salte un cooldown activo de Meta. */
async function ensureLoaded() {
  if (loadedFromDb) return;
  loadedFromDb = true;
  try {
    const row = await prisma.metaGuardState.findUnique({ where: { id: GUARD_ID } });
    if (row?.cooldownUntil) {
      const until = new Date(row.cooldownUntil).getTime();
      if (until > cooldownUntil) {
        cooldownUntil = until;
        cooldownReason = row.reason ?? "persistido";
      }
    }
    if (row?.lastUsagePct) lastUsagePct = Math.max(lastUsagePct, row.lastUsagePct);
  } catch {
    // sin BD disponible: seguimos solo con estado en memoria
  }
}

function persist() {
  const data = {
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil) : null,
    reason: cooldownReason || null,
    lastUsagePct
  };
  prisma.metaGuardState
    .upsert({ where: { id: GUARD_ID }, create: { id: GUARD_ID, ...data }, update: data })
    .catch(() => {});
}

export class MetaCooldownError extends Error {
  constructor(public msUntil: number, reason: string) {
    super(
      `Meta está limitando la cuenta (anti-spam). Enfriamiento activo ~${Math.ceil(
        msUntil / 60000
      )} min. NO reintentes: espera y vuelve a intentarlo más tarde. (${reason})`
    );
    this.name = "MetaCooldownError";
  }
}

export function isMetaInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

export function metaGuardStatus() {
  return {
    inCooldown: isMetaInCooldown(),
    cooldownMsLeft: Math.max(0, cooldownUntil - Date.now()),
    cooldownReason,
    lastUsagePct
  };
}

/** Activa el enfriamiento. `ms` opcional (si Meta indica el tiempo). */
export function startCooldown(ms?: number, reason = "rate-limit") {
  const dur = ms && ms > 0 ? ms : DEFAULT_COOLDOWN_MS;
  const until = Date.now() + dur;
  if (until > cooldownUntil) {
    cooldownUntil = until;
    cooldownReason = reason;
    persist();
  }
}

/** Estado del guardián (en memoria + persistido), para mostrarlo en el panel. */
export async function getMetaGuardState() {
  await ensureLoaded();
  return metaGuardStatus();
}

/** Nota corta legible para adjuntar a los resultados de las tools de Meta. */
export async function metaGuardNote(): Promise<string> {
  const g = await getMetaGuardState();
  if (g.inCooldown) {
    return (
      `⛔ Guardián anti-bloqueo de Meta: EN ENFRIAMIENTO ~${Math.ceil(g.cooldownMsLeft / 60000)} min ` +
      `(Meta está limitando la cuenta${g.cooldownReason ? `: ${g.cooldownReason}` : ""}). ` +
      `NO publiques ni hagas escrituras en Meta; informa al usuario y espera a que pase.`
    );
  }
  if (g.lastUsagePct >= 75) {
    return `⚠️ Guardián Meta OK pero uso de cuota alto (${Math.round(g.lastUsagePct)}%): se están ralentizando las escrituras. Evita ráfagas.`;
  }
  return `✅ Guardián Meta OK · uso de cuota ${Math.round(g.lastUsagePct)}%.`;
}

/**
 * Procesa las cabeceras de uso de una respuesta de Meta. Si el % de cuota
 * está al límite, activa un enfriamiento preventivo corto.
 */
export function noteMetaUsage(headers: Headers | undefined | null) {
  if (!headers) return;
  let maxPct = 0;
  let regainMs = 0;
  for (const key of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const raw = headers.get(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const buckets: any[] = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
      for (const b of buckets) {
        if (!b || typeof b !== "object") continue;
        for (const f of ["call_count", "total_cputime", "total_time", "acc_id_util_pct", "util_pct"]) {
          const v = Number((b as any)[f]);
          if (!isNaN(v)) maxPct = Math.max(maxPct, v);
        }
        const eta = Number((b as any).estimated_time_to_regain_access);
        if (!isNaN(eta) && eta > 0) regainMs = Math.max(regainMs, eta * 60 * 1000);
      }
    } catch {
      // header no-JSON: ignoramos
    }
  }
  if (maxPct > 0) lastUsagePct = maxPct;
  // Si Meta ya nos cortó (eta) o estamos al 95%+, enfriamos.
  if (regainMs > 0) startCooldown(regainMs, "estimated_time_to_regain_access");
  else if (maxPct >= 95) startCooldown(DEFAULT_COOLDOWN_MS, `uso ${maxPct}%`);
}

/** Detecta rate-limit en el cuerpo de un error y activa enfriamiento. */
export function noteMetaErrorBody(status: number, body: string) {
  const isRate =
    status === 429 ||
    body.includes('"code":4') ||
    body.includes('"code":17') ||
    body.includes('"code":613') ||
    body.includes('"code":368') || // bloqueo temporal por comportamiento abusivo
    body.includes('"code":80') || // familia 80xxx: rate limits de marketing API
    /rate.?limit|too.?many|throttl|temporarily blocked|frequency/i.test(body);
  if (!isRate) return false;
  // Intentamos leer minutos sugeridos del propio mensaje.
  let ms = 0;
  const eta = body.match(/estimated_time_to_regain_access["\s:]+(\d+)/i);
  if (eta) ms = Number(eta[1]) * 60 * 1000;
  startCooldown(ms, `error Meta ${status}`);
  return true;
}

/**
 * Verja para ESCRITURAS: serializa y espacia. Llama esto ANTES de cada POST
 * de escritura. Lanza MetaCooldownError si estamos en enfriamiento.
 */
export async function metaWriteGate(): Promise<void> {
  const run = writeChain.then(async () => {
    await ensureLoaded();
    if (isMetaInCooldown()) {
      throw new MetaCooldownError(cooldownUntil - Date.now(), cooldownReason);
    }
    const wait = Math.max(0, lastWriteStart + MIN_WRITE_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    if (lastUsagePct >= HIGH_USAGE_PCT) await sleep(HIGH_USAGE_BACKOFF_MS);
    lastWriteStart = Date.now();
  });
  // La cadena nunca debe quedar rota aunque esta escritura falle.
  writeChain = run.catch(() => {});
  return run;
}
