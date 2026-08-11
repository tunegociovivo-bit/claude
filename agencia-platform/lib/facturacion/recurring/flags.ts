/**
 * Flags del módulo de facturas recurrentes (Slice A). Aditivo y admin-only.
 * Kill-switch server `HUB_RECURRING_INVOICES=off` → endpoints 404. Kill-switch UI
 * `NEXT_PUBLIC_RECURRING_INVOICES=off` → pestaña oculta (fallback total).
 */
export function recurringInvoicesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_RECURRING_INVOICES ?? "").trim().toLowerCase() !== "off";
}
