/**
 * Adapter/Provider del banco (Santander) para preparar/reemitir remesas SEPA.
 *
 * IMPORTANTE: esta implementación NO ejecuta ninguna operación real en Santander
 * ni simula éxito. Mientras no exista una integración oficial configurada, el
 * estado es NOT_CONFIGURED y cualquier intento de preparar la remesa se rechaza
 * de forma explícita. Aprobar una solicitud NO firma ni cobra: solo la deja lista
 * para preparar (cuando exista integración) y, finalmente, pendiente de firma.
 */

export type SantanderProviderStatus = "NOT_CONFIGURED" | "CONFIGURED";

export class ProviderNotConfiguredError extends Error {
  constructor(message = "Integración Santander pendiente de configurar") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Estado del proveedor. Se considera CONFIGURED solo si están TODAS las variables
 * de entorno necesarias. Por defecto (sin credenciales) → NOT_CONFIGURED.
 */
export function getSantanderProviderStatus(): SantanderProviderStatus {
  const base = process.env.SANTANDER_API_BASE_URL;
  const key = process.env.SANTANDER_API_KEY;
  return base && key ? "CONFIGURED" : "NOT_CONFIGURED";
}

export function isSantanderConfigured(): boolean {
  return getSantanderProviderStatus() === "CONFIGURED";
}

/** Mensaje para la UI cuando no hay integración. */
export const SANTANDER_NOT_CONFIGURED_MESSAGE = "Integración Santander pendiente de configurar";

/**
 * Prepara/reemite la remesa en el banco. HOY: no hay integración → lanza siempre
 * ProviderNotConfiguredError. Cuando exista, aquí se implementará la llamada real
 * (nunca desde la aprobación, que es un paso previo e independiente).
 */
export async function prepareRemittance(_opts: {
  remittanceRequestId: string;
  amountCents: number;
  mandateRef: string | null;
}): Promise<never> {
  // No hacemos ninguna operación real ni devolvemos éxito ficticio.
  throw new ProviderNotConfiguredError();
}
