/**
 * GET    /api/v1/task-templates/[id]  → plantilla individual
 * PUT    /api/v1/task-templates/[id]  → actualiza
 * DELETE /api/v1/task-templates/[id]  → elimina (hard delete)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const customFieldSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(100),
  type: z.enum(["text", "textarea", "number", "date", "select", "multiselect", "checkbox", "file"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).max(50).optional(),
  placeholder: z.string().max(200).optional(),
  defaultValue: z.any().optional()
});

const aiWorkflowStepSchema = z.object({
  tool: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()).optional(),
  why: z.string().max(500).optional()
});

const aiWorkflowSchema = z
  .object({
    description: z.string().max(2000).optional(),
    steps: z.array(aiWorkflowStepSchema).min(1).max(50),
    successCriteria: z.string().max(2000).optional()
  })
  .nullable();

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
  defaultProjectId: z.string().optional().nullable(),
  defaultStatus: z.string().max(60).optional().nullable(),
  defaultPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional().nullable(),
  defaultAssigneeIds: z.array(z.string()).max(20).optional().nullable(),
  defaultTags: z.array(z.string()).max(20).optional().nullable(),
  defaultDueOffsetDays: z.number().int().min(0).max(365).optional().nullable(),
  bodyMarkdown: z.string().max(20000).optional().nullable(),
  customFields: z.array(customFieldSchema).max(30).optional().nullable(),
  aiWorkflow: aiWorkflowSchema.optional()
});

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const tpl = await prisma.taskTemplate.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!tpl) throw new ApiError(404, "not_found", "Plantilla no encontrada");
  return NextResponse.json(tpl);
});

export const PUT = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const tpl = await prisma.taskTemplate.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!tpl) throw new ApiError(404, "not_found", "Plantilla no encontrada");
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.message);
  }
  try {
    const updated = await prisma.taskTemplate.update({
      where: { id: params.id },
      data: parsed.data as any
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.code === "P2002") {
      throw new ApiError(409, "duplicate_name", "Ya existe una plantilla con ese nombre");
    }
    throw e;
  }
});

export const DELETE = withApi({ scope: "tasks:write" }, async (_req, { params, api }) => {
  const tpl = await prisma.taskTemplate.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!tpl) throw new ApiError(404, "not_found", "Plantilla no encontrada");
  await prisma.taskTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
