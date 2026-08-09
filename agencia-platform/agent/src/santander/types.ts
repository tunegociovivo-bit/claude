/**
 * Contratos del adaptador de Santander Empresas. La LÓGICA DE NEGOCIO (qué
 * trabajo, qué importe, cuándo pausar) vive fuera; el adaptador solo sabe
 * "conducir" el portal según una MÁQUINA DE ESTADOS y unos SELECTORES externos.
 *
 * INVARIANTES DE SEGURIDAD (válidas para cualquier implementación):
 *  - Nunca firma, confirma en firme ni ejecuta un cobro. Termina ANTES de firmar.
 *  - Solo opera en el host oficial (allowlist). Cualquier otro host → pausa.
 *  - Ante login/OTP/CAPTCHA/cambios de interfaz/ambigüedad/discrepancia → pausa.
 *  - Debe VERIFICAR VISUALMENTE el estado "pendiente de firma" antes de cerrar OK.
 */

/** Datos AUTORIZADOS del trabajo (sin secretos). Vienen del HUB. */
export interface AuthorizedJob {
  jobId: string;
  invoiceNumber: string | null;
  clientName: string;
  amountCents: number;
  currency: string;
  mandateRef: string | null;
  ibanMasked: string | null;
  /** Nombre exacto de la remesa recurrente que se edita en Santander. */
  santanderTemplate: string | null;
}

/** Estados de la máquina del adaptador. */
export type AdapterState =
  | "INIT"
  | "CHECK_ALLOWLIST"
  | "CHECK_SESSION"          // ¿el usuario ya ha iniciado sesión? (no la hacemos nosotros)
  | "OPEN_REMITTANCES"       // ir a la sección de remesas/adeudos
  | "SELECT_PREVIOUS"        // localizar la remesa recurrente anterior para reutilizar
  | "EDIT_PREVIOUS"          // editar la anterior (no duplicarla)
  | "EDIT_AUTHORIZED"        // cambiar SOLO la fecha de cobro
  | "VALIDATE_MATCH"         // cotejar importe/cliente/IBAN con lo autorizado
  | "PREPARE_FOR_SIGNATURE"  // dejar lista para firma (SIN firmar)
  | "VERIFY_PENDING"         // verificar visualmente el estado "pendiente de firma"
  | "DONE"
  | "PAUSED";                // requiere intervención humana

/** Resultado de una acción del adaptador. */
export type StepOutcome =
  | { kind: "CONTINUE"; next: AdapterState; progress: string }
  | { kind: "NEEDS_USER"; reason: string }
  | { kind: "PREPARED"; resultRef?: string }   // preparado y verificado pendiente de firma
  | { kind: "FAILED"; error: string };

/** Callbacks para reportar al HUB (inyectados por el runner). */
export interface AdapterHooks {
  onProgress: (state: AdapterState, progress: string) => Promise<void>;
  onNeedsUser: (reason: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface SantanderAdapter {
  /** Ejecuta la máquina de estados hasta DONE/PAUSED/FAILED. Nunca firma. */
  run(job: AuthorizedJob, hooks: AdapterHooks): Promise<StepOutcome>;
  /** Libera recursos (no cierra el Chrome del usuario). */
  close(): Promise<void>;
}

/**
 * Etiquetas/textos que JAMÁS deben pulsarse. Barrera dura anti-firma: si el
 * adaptador estuviera a punto de accionar algo con estos textos, aborta y pausa.
 */
export const FORBIDDEN_ACTION_PATTERNS: RegExp[] = [
  /\bfirmar\b/i,
  /\bfirma\b/i,
  /\bconfirmar (env[ií]o|remesa|orden|pago)\b/i,
  /\bautorizar\b/i,
  /\benviar al banco\b/i,
  /\bejecutar\b/i,
  /\bpagar\b/i,
  /\bfirmar ahora\b/i,
  /\bsign\b/i
];

export function isForbiddenActionLabel(label: string): boolean {
  return FORBIDDEN_ACTION_PATTERNS.some((re) => re.test(label));
}
