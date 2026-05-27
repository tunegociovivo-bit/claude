/** Categorías y utilidades de gastos. */

export const EXPENSE_CATEGORIES = [
  "CUOTA_AUTONOMO",
  "SOFTWARE",
  "PUBLICIDAD",
  "PROVEEDORES",
  "SUMINISTROS",
  "ALQUILER",
  "MATERIAL",
  "VIAJES",
  "IMPUESTOS",
  "BANCO",
  "OTROS"
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  CUOTA_AUTONOMO: "Cuota autónomos / SS",
  SOFTWARE: "Software y suscripciones",
  PUBLICIDAD: "Publicidad y marketing",
  PROVEEDORES: "Proveedores / subcontratación",
  SUMINISTROS: "Suministros (luz, agua, internet)",
  ALQUILER: "Alquiler",
  MATERIAL: "Material y equipos",
  VIAJES: "Viajes y dietas",
  IMPUESTOS: "Impuestos y tasas",
  BANCO: "Comisiones bancarias",
  OTROS: "Otros"
};

export const EXPENSE_STATUS = ["PENDING", "PAID"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUS)[number];

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  PENDING: "Pendiente",
  PAID: "Pagado"
};

/** Calcula cuota de IVA y total a partir de la base y el tipo. */
export function computeExpenseTotals(baseCents: number, taxRate: number): { taxCents: number; totalCents: number } {
  const base = Math.round(baseCents || 0);
  const taxCents = Math.round((base * (taxRate || 0)) / 100);
  return { taxCents, totalCents: base + taxCents };
}
