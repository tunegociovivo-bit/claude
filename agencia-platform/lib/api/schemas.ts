import { z } from "zod";

export const clientCreateSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"]).default("ACTIVE"),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mrr: z.number().int().min(0).default(0),
  notes: z.string().optional()
});

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  clientId: z.string().optional(),
  description: z.string().optional(),
  color: z.string().default("bg-brand-500")
});

export const taskCreateSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().datetime().optional(),
  assigneeIds: z.array(z.string()).default([]),
  parentId: z.string().optional()
});

export const documentCreateSchema = z.object({
  title: z.string().min(1).default("Sin título"),
  parentId: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional()
});

export const eventCreateSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  type: z.enum(["PUBLICATION", "MEETING", "DEADLINE", "CAMPAIGN", "OTHER"]).default("MEETING"),
  clientId: z.string().optional(),
  allDay: z.boolean().default(false)
});
