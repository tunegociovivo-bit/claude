/**
 * Extractor de credenciales temporales inyectadas en una tarea.
 *
 * Permite que el user pegue tokens/api keys en la descripción o en
 * comentarios de la tarea, y que Sonia los use SOLO para ese run
 * (sin tocar las integraciones cifradas del workspace).
 *
 * Casos de uso:
 *   - "El token oficial de Meta caducó — usa este temporal hasta que
 *     reconecte: META_ADS_TOKEN=EAAxxx..."
 *   - Encargos puntuales con cuentas distintas a las del workspace.
 *   - Pruebas / migraciones / accesos delegados de cliente.
 *
 * Privacidad:
 *   - Las credenciales NUNCA se guardan en BD por este sistema. Viven
 *     solo en memoria del proceso durante el run.
 *   - No las metemos en el log del AiAgentRun ni en el summary.
 *   - Quedan visibles en el texto del task/comentarios (donde el user
 *     las pegó) — eso es responsabilidad del user.
 *
 * Formatos soportados:
 *
 *   1) Líneas KEY=valor o KEY: valor (case-insensitive en el key, se
 *      normaliza a UPPER_SNAKE):
 *        META_ADS_TOKEN=EAAxxx...
 *        meta_ads_token: EAAxxx...
 *        META_ADS_AD_ACCOUNT_ID=act_951272100695739
 *
 *   2) Bloque fenced con etiqueta `credentials`, `creds`, o `env`:
 *        ```credentials
 *        META_ADS_TOKEN=EAAxxx...
 *        HOLDED_API_KEY=xxx
 *        ```
 *
 *   3) Bloque JSON con etiqueta `credentials`:
 *        ```credentials
 *        { "meta_ads_token": "EAAxxx", "stripe_key": "sk_test_xxx" }
 *        ```
 *
 * Claves canónicas (lo que las tools esperan):
 *   META_ADS_TOKEN, META_ADS_AD_ACCOUNT_ID,
 *   GOOGLE_ADS_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
 *   HOLDED_API_KEY, STRIPE_KEY, WAHA_URL, WAHA_API_KEY,
 *   RESEND_KEY, ELEVENLABS_KEY
 *
 * Si el user usa una variante (ej "metaAdsToken" o "fb_ads_access_token"),
 * intentamos normalizar — ver KEY_ALIASES.
 */

const KEY_ALIASES: Record<string, string> = {
  // Meta Ads
  meta_ads_token: "META_ADS_TOKEN",
  meta_token: "META_ADS_TOKEN",
  fb_ads_token: "META_ADS_TOKEN",
  fb_access_token: "META_ADS_TOKEN",
  facebook_access_token: "META_ADS_TOKEN",
  meta_access_token: "META_ADS_TOKEN",
  meta_ads_ad_account_id: "META_ADS_AD_ACCOUNT_ID",
  meta_ads_account: "META_ADS_AD_ACCOUNT_ID",
  ad_account_id: "META_ADS_AD_ACCOUNT_ID",
  fb_ad_account: "META_ADS_AD_ACCOUNT_ID",
  // Google Ads
  google_ads_token: "GOOGLE_ADS_TOKEN",
  google_ads_developer_token: "GOOGLE_ADS_DEVELOPER_TOKEN",
  google_ads_customer_id: "GOOGLE_ADS_CUSTOMER_ID",
  // Otros
  holded_api_key: "HOLDED_API_KEY",
  holded_key: "HOLDED_API_KEY",
  stripe_key: "STRIPE_KEY",
  stripe_secret: "STRIPE_KEY",
  waha_url: "WAHA_URL",
  waha_api_key: "WAHA_API_KEY",
  resend_key: "RESEND_KEY",
  resend_api_key: "RESEND_KEY",
  elevenlabs_key: "ELEVENLABS_KEY",
  elevenlabs_api_key: "ELEVENLABS_KEY"
};

function normalizeKey(rawKey: string): string {
  const k = rawKey.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (KEY_ALIASES[k]) return KEY_ALIASES[k];
  // Default: el key tal cual en UPPER_SNAKE_CASE (admite keys
  // que aún no hemos mapeado).
  return k.toUpperCase();
}

function isPlausibleCredKey(canonical: string): boolean {
  // Solo aceptamos claves cuyo nombre sugiera credencial.
  return /(TOKEN|KEY|SECRET|ACCOUNT|CUSTOMER|URL)/.test(canonical);
}

/**
 * Extrae credenciales de un texto libre (descripción + comentarios
 * concatenados). Devuelve un map de KEY canónica → valor.
 *
 * Idempotente. Si el mismo key aparece varias veces, gana la última
 * (asumimos que el user corrigió hacia abajo).
 */
export function extractAdhocCredentials(text: string): Record<string, string> {
  if (!text || typeof text !== "string") return {};
  const out: Record<string, string> = {};

  // ── 1) Bloques fenced con etiqueta credentials/creds/env ──
  // Capturamos el contenido y lo procesamos como sub-texto recursivo
  // (admite KEY=valor dentro y también JSON).
  const FENCE_RE = /```(?:credentials|creds|env|secrets)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const inner = m[1];
    // Intento JSON primero
    const jsonMatch = inner.trim();
    if (jsonMatch.startsWith("{")) {
      try {
        const parsed = JSON.parse(jsonMatch);
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v !== "string" && typeof v !== "number") continue;
          const canonical = normalizeKey(k);
          if (isPlausibleCredKey(canonical)) out[canonical] = String(v).trim();
        }
        continue;
      } catch {
        // cae al parseo línea-a-línea
      }
    }
    Object.assign(out, parseLinesAsCreds(inner));
  }

  // ── 2) Líneas KEY=valor o KEY: valor en el resto del texto ──
  // Quitamos los bloques fenced ya procesados para no duplicar.
  const stripped = text.replace(FENCE_RE, "");
  Object.assign(out, parseLinesAsCreds(stripped));

  return out;
}

function parseLinesAsCreds(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  // KEY=valor o KEY: valor — el valor llega hasta fin de línea.
  // Permitimos comillas opcionales alrededor del valor.
  const LINE_RE = /(^|[\s>*\-•])([A-Za-z][A-Za-z0-9_\- ]{2,50})\s*[:=]\s*["']?([^\s"'\n\r]{8,})["']?/g;
  let m: RegExpExecArray | null;
  while ((m = LINE_RE.exec(text)) !== null) {
    const rawKey = m[2];
    const rawVal = m[3];
    const canonical = normalizeKey(rawKey);
    if (!isPlausibleCredKey(canonical)) continue;
    // Filtramos valores que claramente NO son credenciales (URLs sin
    // credencial, frases, etc.). Una credencial real es alfanumérica
    // con posible | / . _ - y >=12 chars típicamente.
    if (rawVal.length < 8) continue;
    if (/^https?:\/\//.test(rawVal) && !canonical.endsWith("_URL")) continue;
    out[canonical] = rawVal.trim();
  }
  return out;
}

/**
 * Redacta credenciales en un texto para logging seguro. Reemplaza
 * cualquier ocurrencia de los valores por "***REDACTED***".
 *
 * Útil para no filtrar tokens en el log del AiAgentRun.
 */
export function redactCredentials(text: string, creds: Record<string, string>): string {
  if (!text) return text;
  let out = text;
  for (const v of Object.values(creds)) {
    if (v && v.length >= 8) {
      out = out.split(v).join("***REDACTED***");
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// Persistencia: los credenciales pegados en cualquier task se
// GUARDAN cifrados en Workspace.settings.adhocCredentials y
// quedan disponibles para todos los siguientes runs hasta que se
// sustituyan por valores nuevos del mismo KEY.
//
// Decisión: usamos JSON en settings (cifrando cada valor con
// encryptSecret) en vez de tabla nueva. Evita migración + reusa
// la AES-256-GCM key existente. Coste: ~200 bytes por credencial,
// trivial para el tamaño máximo de un JSONB.
// ────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

type StoredCredEntry = {
  enc: string;
  updatedAt: string;
  /** task donde el user pegó esta credencial por última vez (auditoría). */
  sourceTaskId?: string;
};

type StoredCredsMap = Record<string, StoredCredEntry>;

/**
 * Lee + descifra todas las credenciales ad-hoc almacenadas en el
 * workspace. Devuelve un map plano KEY → valor descifrado.
 *
 * Si el descifrado falla para alguna entrada (key cambió, datos
 * corruptos), esa entrada se omite silenciosamente — no rompe.
 */
export async function loadStoredAdhocCredentials(
  workspaceId: string
): Promise<Record<string, string>> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const stored = (ws?.settings as any)?.adhocCredentials as StoredCredsMap | undefined;
  if (!stored || typeof stored !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(stored)) {
    try {
      const v = decryptSecret(entry.enc);
      if (v) out[key] = v;
    } catch {
      // omit
    }
  }
  return out;
}

/**
 * Guarda/actualiza credenciales en el workspace. SOBRESCRIBE las
 * KEYs presentes en `creds`, deja intactas las que no lo están.
 * Idempotente.
 *
 * @param sourceTaskId — para auditoría. Quedará anotado de qué task
 *                       vino la última actualización.
 */
export async function persistAdhocCredentials(
  workspaceId: string,
  creds: Record<string, string>,
  sourceTaskId?: string
): Promise<void> {
  if (!creds || Object.keys(creds).length === 0) return;
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const settings = (ws?.settings as any) ?? {};
  const stored: StoredCredsMap = settings.adhocCredentials ?? {};
  const nowIso = new Date().toISOString();
  for (const [key, value] of Object.entries(creds)) {
    if (!value || value.length < 8) continue;
    stored[key] = {
      enc: encryptSecret(value),
      updatedAt: nowIso,
      ...(sourceTaskId ? { sourceTaskId } : {})
    };
  }
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { settings: { ...settings, adhocCredentials: stored } as any }
  });
}

/**
 * Borra una credencial concreta del workspace. Útil para "olvidar"
 * tokens (ej tras incident response, o cuando una integración
 * oficial vuelve a estar operativa).
 */
export async function deleteAdhocCredential(workspaceId: string, key: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const settings = (ws?.settings as any) ?? {};
  const stored: StoredCredsMap = settings.adhocCredentials ?? {};
  if (!stored[key]) return false;
  delete stored[key];
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { settings: { ...settings, adhocCredentials: stored } as any }
  });
  return true;
}

/**
 * Lista las KEYs almacenadas SIN devolver los valores. Para UI
 * de admin "qué credenciales tiene Sonia guardadas".
 */
export async function listStoredAdhocCredentialKeys(
  workspaceId: string
): Promise<Array<{ key: string; updatedAt: string; sourceTaskId?: string }>> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const stored = (ws?.settings as any)?.adhocCredentials as StoredCredsMap | undefined;
  if (!stored) return [];
  return Object.entries(stored).map(([key, e]) => ({
    key,
    updatedAt: e.updatedAt,
    sourceTaskId: e.sourceTaskId
  }));
}
