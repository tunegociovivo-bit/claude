import { z } from "zod";
import { EXPENSE_CATEGORIES, EXPENSE_STATUS } from "@/lib/invoicing/expenses";
import { PAYMENT_METHODS, CURRENCIES } from "@/lib/invoicing/core";

// Esquema de validación de gastos. Vive aquí (y no en route.ts) porque un
// archivo route.ts de Next.js 14 solo puede exportar handlers/config; exportar
// `expenseSchema` desde la ruta rompe el build.
export const expenseSchema = z.object({
  issuerId: z.string().nullish(),
  date: z.string().datetime().optional(),
  category: z.enum(EXPENSE_CATEGORIES).default("OTROS"),
  supplier: z.string().max(200).nullish(),
  supplierTaxId: z.string().max(40).nullish(),
  concept: z.string().max(5000).nullish(),
  currency: z.enum(CURRENCIES).default("EUR"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("TRANSFER"),
  status: z.enum(EXPENSE_STATUS).default("PAID"),
  baseCents: z.number().int(),
  taxRate: z.number().min(0).max(100).default(21),
  deductible: z.boolean().default(true),
  notes: z.string().max(5000).nullish(),
  fileUrl: z.string().url().nullish()
});
