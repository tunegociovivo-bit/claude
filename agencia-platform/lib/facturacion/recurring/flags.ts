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
