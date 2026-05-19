/**
 * GET    /api/v1/task-templates           → lista plantillas del workspace
 * POST   /api/v1/task-templates           → crea plantilla
 *
 * Las plantillas precargan campos en el TaskFormModal + un schema
 * de custom fields que se renderizan dinámicamente.
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
  type: z.enum(["text", "textarea", "number", "date", "select", "multiselect", "checkbox"]),
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

const templateSchema = z.object({
  name: z.string().min(1).max(120),
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

export const GET = withApi({ scope: "tasks:read" }, async (_req, { api }) => {
  const items = await prisma.taskTemplate.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: [{ name: "asc" }]
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.message);
  }
  try {
    const created = await prisma.taskTemplate.create({
      data: {
        ...parsed.data,
        workspaceId: api.workspaceId,
        createdById: api.userId ?? null,
        defaultAssigneeIds: parsed.data.defaultAssigneeIds ?? undefined,
        defaultTags: parsed.data.defaultTags ?? undefined,
        customFields: parsed.data.customFields ?? undefined,
        aiWorkflow: parsed.data.aiWorkflow ?? undefined
      } as any
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      throw new ApiError(409, "duplicate_name", "Ya existe una plantilla con ese nombre");
    }
    throw e;
  }
});
