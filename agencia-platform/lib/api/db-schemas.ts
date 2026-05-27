import { z } from "zod";

export const propertyTypes = [
  "TEXT",
  "NUMBER",
  "SELECT",
  "MULTI_SELECT",
  "DATE",
  "PERSON",
  "CHECKBOX",
  "URL",
  "EMAIL",
  "PHONE",
  "FILE",
  "RELATION",
  "ROLLUP",
  "FORMULA",
  "CREATED_TIME",
  "CREATED_BY"
] as const;

export const viewTypes = ["TABLE", "BOARD", "CALENDAR", "TIMELINE", "GALLERY", "LIST"] as const;

export const databaseCreateSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  documentId: z.string().optional()
});

export const propertyCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(propertyTypes),
  config: z.any().optional(),
  order: z.number().int().optional()
});

export const propertyUpdateSchema = propertyCreateSchema.partial();

export const recordCreateSchema = z.object({
  title: z.string().default("Sin título"),
  values: z.record(z.string(), z.any()).optional() // { propertyId: value }
});

export const valuePatchSchema = z.object({
  propertyId: z.string(),
  value: z.any()
});

export const viewCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(viewTypes),
  config: z.any().optional(),
  order: z.number().int().optional()
});
