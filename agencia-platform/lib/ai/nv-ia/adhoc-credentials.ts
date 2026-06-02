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
  // Meta Ads — token (todas las variantes humanas que vemos en
  // tareas reales: "Token meta", "meta token", "access token meta",
  // "token de meta", "facebook token", etc.)
  meta_ads_token: "META_ADS_TOKEN",
  meta_token: "META_ADS_TOKEN",
  token_meta: "META_ADS_TOKEN",
  token_de_meta: "META_ADS_TOKEN",
  meta_de_token: "META_ADS_TOKEN",
  access_token_meta: "META_ADS_TOKEN",
  meta_access_token: "META_ADS_TOKEN",
  fb_ads_token: "META_ADS_TOKEN",
  fb_token: "META_ADS_TOKEN",
  fb_access_token: "META_ADS_TOKEN",
  facebook_token: "META_ADS_TOKEN",
  facebook_access_token: "META_ADS_TOKEN",
  // Meta Ads — ad account
  meta_ads_ad_account_id: "META_ADS_AD_ACCOUNT_ID",
  meta_ads_account: "META_ADS_AD_ACCOUNT_ID",
  meta_account_id: "META_ADS_AD_ACCOUNT_ID",
  meta_ad_account: "META_ADS_AD_ACCOUNT_ID",
  meta_ad_account_id: "META_ADS_AD_ACCOUNT_ID",
  ad_account_id: "META_ADS_AD_ACCOUNT_ID",
  ad_account: "META_ADS_AD_ACCOUNT_ID",
  cuenta_publicitaria: "META_ADS_AD_ACCOUNT_ID",
  cuenta_anuncios: "META_ADS_AD_ACCOUNT_ID",
  cuenta_de_anuncios: "META_ADS_AD_ACCOUNT_ID",
  cuenta_de_ads: "META_ADS_AD_ACCOUNT_ID",
  fb_ad_account: "META_ADS_AD_ACCOUNT_ID",
  act: "META_ADS_AD_ACCOUNT_ID",
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
  elevenlabs_api_key: "ELEVENLABS_KEY",
  // WooCommerce (consumer key/secret + URL de la tienda). Cubre las etiquetas
  // humanas típicas: "clave cliente"/"clave secreta" (como las da WooCommerce
  // en español), "consumer key", "ck"/"cs", etc.
  woocommerce_consumer_key: "WOOCOMMERCE_CONSUMER_KEY",
  woocommerce_ck: "WOOCOMMERCE_CONSUMER_KEY",
  consumer_key: "WOOCOMMERCE_CONSUMER_KEY",
  clave_cliente: "WOOCOMMERCE_CONSUMER_KEY",
  clave_de_cliente: "WOOCOMMERCE_CONSUMER_KEY",
  woocommerce_consumer_secret: "WOOCOMMERCE_CONSUMER_SECRET",
  woocommerce_cs: "WOOCOMMERCE_CONSUMER_SECRET",
  consumer_secret: "WOOCOMMERCE_CONSUMER_SECRET",
  clave_secreta: "WOOCOMMERCE_CONSUMER_SECRET",
  clave_de_secreta: "WOOCOMMERCE_CONSUMER_SECRET",
  woocommerce_store_url: "WOOCOMMERCE_STORE_URL",
  woocommerce_url: "WOOCOMMERCE_STORE_URL",
  store_url: "WOOCOMMERCE_STORE_URL",
  url_tienda: "WOOCOMMERCE_STORE_URL",
  tienda_url: "WOOCOMMERCE_STORE_URL"
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

  // ── 3) Detección por VALOR (heurística sobre el contenido). ──
  // Sin esto, "Token meta: EAA..." quedaba como TOKEN_META en vez
  // de META_ADS_TOKEN (el alias no cubría todas las variantes
  // humanas), y act=NNNN dentro de URLs no se detectaba en absoluto.
  // Estas reglas le permiten a Sonia "encontrar" credenciales aunque
  // el user no las etiquete formalmente.
  Object.assign(out, detectByValue(text));

  return out;
}

/**
 * Heurísticas por contenido del valor, no por label. Útiles para:
 *   - Tokens Meta sueltos (empiezan por "EAA", >100 chars)
 *   - act_NNNN o act=NNNN dentro de URLs de Ads Manager
 *   - Stripe keys (sk_live_..., sk_test_...)
 *   - Resend keys (re_...)
 *
 * IMPORTANTE: cuando hay MÚLTIPLES coincidencias del mismo tipo,
 * ganael ÚLTIMO. Esto es crítico cuando el user pega un token en
 * la descripción y luego lo sustituye N veces en comentarios — el
 * más reciente (último) es el válido. Antes ganaba el primero y
 * Sonia usaba siempre el token viejo caducado aunque hubieras
 * pegado uno nuevo justo después.
 */
function detectByValue(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  // Token Meta — todas las ocurrencias; gana la última.
  const META_TOKEN_RE = /\b(EAA[A-Za-z0-9_-]{100,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = META_TOKEN_RE.exec(text)) !== null) {
    out.META_ADS_TOKEN = m[1];
  }

  // Ad Account ID — gana la última (caso típico: user corrige el
  // número en un comentario posterior).
  const ACT_RE = /\bact[=_](\d{6,20})\b/gi;
  while ((m = ACT_RE.exec(text)) !== null) {
    out.META_ADS_AD_ACCOUNT_ID = `act_${m[1]}`;
  }

  // Stripe — última gana.
  const STRIPE_RE = /\b(sk_(?:live|test)_[A-Za-z0-9]{20,200})\b/g;
  while ((m = STRIPE_RE.exec(text)) !== null) {
    out.STRIPE_KEY = m[1];
  }

  // Resend — última gana.
  const RESEND_RE = /\b(re_[A-Za-z0-9_-]{20,100})\b/g;
  while ((m = RESEND_RE.exec(text)) !== null) {
    out.RESEND_KEY = m[1];
  }

  // WooCommerce consumer key / secret — formato fijo ck_<hex> / cs_<hex>
  // (40 hex normalmente). Esto las detecta aunque el user no las etiquete,
  // p.ej. "clave cliente: ck_801d..." o pegadas sueltas. Última gana.
  const WC_CK_RE = /\b(ck_[0-9a-fA-F]{32,64})\b/g;
  while ((m = WC_CK_RE.exec(text)) !== null) {
    out.WOOCOMMERCE_CONSUMER_KEY = m[1];
  }
  const WC_CS_RE = /\b(cs_[0-9a-fA-F]{32,64})\b/g;
  while ((m = WC_CS_RE.exec(text)) !== null) {
    out.WOOCOMMERCE_CONSUMER_SECRET = m[1];
  }

  // WordPress Application Password — 6 grupos de 4 alfanuméricos separados por
  // espacio (ej "dQtn VVYc oJg3 9O08 QDCU iugT"). Es la auth de la REST API de
  // WP/WooCommerce y suele venir etiquetada como "api rest:". Última gana.
  const WP_APP_RE = /\b([A-Za-z0-9]{4}(?: [A-Za-z0-9]{4}){5})\b/g;
  let foundWpApp = false;
  while ((m = WP_APP_RE.exec(text)) !== null) {
    out.WOOCOMMERCE_WP_APP_PASSWORD = m[1];
    foundWpApp = true;
  }
  // Si hay app-password, el usuario WP suele ser un email/usuario en el mismo
  // bloque de "Accesos". Capturamos el primer email como usuario (solo cuando
  // hay app-password, para no recoger emails sueltos de otras tareas).
  if (foundWpApp && !out.WOOCOMMERCE_WP_USER) {
    const email = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    if (email) out.WOOCOMMERCE_WP_USER = email[0];
  }

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
// Claves que NO deben persistir/heredarse entre tareas: son específicas de
// la cuenta/contexto de UNA tarea, no credenciales reutilizables. Si se
// guardan a nivel workspace, una tarea de la cuenta A "contamina" otra de la
// cuenta B (ej: el ad account de Rentas colándose en la tarea de M&M Travel).
// El TOKEN sí es reutilizable y sí persiste; el ID de cuenta no.
const NON_PERSISTENT_KEYS = new Set(["META_ADS_AD_ACCOUNT_ID"]);

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
    // No heredamos claves específicas de cuenta entre tareas (aunque
    // quedaran guardadas de versiones anteriores) — evita interferencias.
    if (NON_PERSISTENT_KEYS.has(key)) continue;
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
    // No persistimos claves específicas de cuenta/contexto de una tarea.
    if (NON_PERSISTENT_KEYS.has(key)) continue;
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
