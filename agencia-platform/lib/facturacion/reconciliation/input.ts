import { z } from "zod";

const santanderRemittanceNumberSchema = z.string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9 ]+$/)
  .transform((value) => value.replace(/\s+/g, "").toUpperCase());

export const bankMovementInputSchema = z.object({
  externalId: z.string().min(1).max(200),
  bookedAt: z.string().datetime(),
  valueAt: z.string().datetime().nullable().optional(),
  amountCents: z.number().int().refine((value) => value !== 0, "El importe no puede ser cero"),
  currency: z.string().length(3).optional(),
  counterpartyName: z.string().max(200).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  accountMasked: z.string().max(40).nullable().optional(),
  remittanceNumber: santanderRemittanceNumberSchema.nullable().optional(),
  debtorIbanLast4: z.string().regex(/^\d{4}$/).nullable().optional()
});
