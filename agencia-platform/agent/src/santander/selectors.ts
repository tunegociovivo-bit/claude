/**
 * Carga de SELECTORES del portal desde un fichero externo (nunca embebidos ni
 * inventados). Se generan con el modo de grabación guiada (`npm run record`)
 * durante una sesión real supervisada por el usuario.
 *
 * NOTA IMPORTANTE: este proyecto NO incluye selectores finales del portal real.
 * Hasta que exista `selectors.json` (mapeado por el usuario), el adaptador LIVE
 * pausa y pide realizar el mapeo guiado. Así evitamos "adivinar" selectores.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cada paso declara cómo localizar su elemento. Se admiten selectores CSS,
 * texto de rol/etiqueta (para getByRole/getByText de Playwright) o XPath.
 * NO se declara ningún selector de "firmar": firmar está prohibido por diseño.
 */
export interface SelectorSpec {
  css?: string;
  role?: { role: string; name?: string };
  text?: string;
  xpath?: string;
  /** Restringe un selector CSS a un contenedor con este texto. */
  hasText?: string;
  /** Descripción legible para logs y para el modo grabación. */
  describe: string;
}

export interface SantanderSelectors {
  /** Marca del portal para detectar sesión iniciada (algo visible solo tras login). */
  sessionReady: SelectorSpec;
  /** Enlace/menú a remesas de adeudos SEPA (Norma 19 / recibos). */
  remittancesNav: SelectorSpec;
  /** Localizador de la remesa recurrente ANTERIOR (para reutilizar). */
  previousRemittance: SelectorSpec;
  /** Menú contextual de la fila localizada. */
  rowMenuAction: SelectorSpec;
  /** Acción "Editar" (nunca "Duplicar"). */
  editAction: SelectorSpec;
  /** Acción "Modificar" dentro de Datos de la remesa. */
  modifyRemittanceAction: SelectorSpec;
  /** Campo de fecha de cobro editable. */
  chargeDateField: SelectorSpec;
  /** Continuar entre pasos del generador. */
  continueAction: SelectorSpec;
  /** Importe mostrado, solo para cotejo: nunca se modifica. */
  amountLabel: SelectorSpec;
  /** Campo de importe de la única orden recurrente, modificable al total autorizado. */
  amountField: SelectorSpec;
  /** Elemento que muestra el cliente/deudor (para cotejo). */
  clientLabel: SelectorSpec;
  /** Elemento que muestra el IBAN (enmascarado) del deudor (para cotejo). */
  ibanLabel?: SelectorSpec;
  /**
   * Acción que deja la remesa LISTA para firma SIN firmarla (p. ej. "Guardar",
   * "Preparar", "Añadir a firmas pendientes"). NUNCA debe ser "Firmar".
   */
  firstSendAction: SelectorSpec;
  basicPaymentsOption: SelectorSpec;
  directDebitOption: SelectorSpec;
  acceptAction: SelectorSpec;
  secondSendAction: SelectorSpec;
  /** Elemento/badge que confirma visualmente el estado "pendiente de firma". */
  pendingSignatureIndicator: SelectorSpec;
  /** Salida segura del diálogo: "Firmar luego". */
  signLaterAction: SelectorSpec;
}

export function exactRoleNamePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

const REQUIRED_KEYS: (keyof SantanderSelectors)[] = [
  "sessionReady", "remittancesNav", "previousRemittance", "rowMenuAction", "editAction",
  "modifyRemittanceAction", "chargeDateField", "continueAction", "amountLabel", "amountField", "clientLabel",
  "firstSendAction", "basicPaymentsOption", "directDebitOption", "acceptAction", "secondSendAction",
  "pendingSignatureIndicator", "signLaterAction"
];

export type SelectorsResult =
  | { ok: true; selectors: SantanderSelectors }
  | { ok: false; reason: string };

export function loadSelectors(file: string): SelectorsResult {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) {
    return { ok: false, reason: `No existe el fichero de selectores (${file}). Ejecuta el mapeo guiado ('npm run record') en una sesión real supervisada.` };
  }
  let json: any;
  try {
    json = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { ok: false, reason: `El fichero de selectores no es JSON válido (${file}).` };
  }
  const missing = REQUIRED_KEYS.filter((k) => !json?.[k]);
  if (missing.length) {
    return { ok: false, reason: `Faltan selectores obligatorios: ${missing.join(", ")}. Completa el mapeo guiado.` };
  }
  return { ok: true, selectors: json as SantanderSelectors };
}
