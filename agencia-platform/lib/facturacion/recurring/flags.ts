/**
 * Flags del módulo de facturas recurrentes (Slice A). Aditivo, admin-only y
 * OPT-IN (por defecto OFF) — es un módulo financiero nuevo: solo se activa con
 * `HUB_RECURRING_INVOICES=on` (endpoints; si no, 404) y `NEXT_PUBLIC_RECURRING_
 * INVOICES=on` (pestaña; si no, oculta). Así no se expone hasta revisarlo y hasta
 * que `db push` haya creado la tabla.
 */
export function recurringInvoicesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_RECURRING_INVOICES ?? "").trim().toLowerCase() === "on";
}

/**
 * Separación de la lista de facturas (Slice B): cuando está ON, `GET /invoices`
 * EXCLUYE las plantillas recurrentes legadas (`recurring:true`) para no mezclarlas
 * con las emitidas. OPT-IN (default OFF → comportamiento actual intacto; el motor
 * legado sigue funcionando igual, esto solo afecta al LISTADO).
 */
export function recurringSeparationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_RECURRING_SEPARATE ?? "").trim().toLowerCase() === "on";
}

/**
 * Motor recurrente nativo en SHADOW (Slice C). OPT-IN (default OFF). Cuando está
 * ON, el endpoint de shadow-run calcula ocurrencias y persiste PREVIEWS (nunca
 * facturas). No hay cron automático: solo se ejecuta bajo demanda por admin.
 */
export function recurringEngineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_RECURRING_ENGINE ?? "").trim().toLowerCase() === "on";
}

/**
 * Pausa masiva de plantillas Hub (Slice D). OPT-IN (default OFF). Acción sensible
 * (A4): además del flag exige admin + frase de confirmación fuerte. El checklist
 * asistido de Holded (sin mutación remota) vive tras el mismo flag.
 */
export function recurringPauseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_RECURRING_PAUSE ?? "").trim().toLowerCase() === "on";
}
