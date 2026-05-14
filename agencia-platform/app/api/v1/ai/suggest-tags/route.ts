import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  taskId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional()
});

export const POST = withApi({ scope: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let title = parsed.data.title ?? "";
  let description = parsed.data.description ?? "";
  if (parsed.data.taskId) {
    const t = await prisma.task.findFirst({
      where: { id: parsed.data.taskId, workspaceId: api.workspaceId }
    });
    if (t) {
      title = t.title;
      description = t.description ?? description;
    }
  }
  if (!title.trim()) throw new ApiError(400, "validation_error", "Falta título o taskId");

  const existing = await prisma.tag.findMany({
    where: { workspaceId: api.workspaceId },
    select: { name: true }
  });
  const existingNames = existing.map((t) => t.name);

  try {
    const result = await completeJson<{ tags: string[] }>({
      workspaceId: api.workspaceId,
      system:
        "Eres asistente de productividad para una agencia de marketing. Sugieres 3-5 etiquetas en español, en minúsculas, sin emojis, ni acentos en palabras claves comunes (instagram, blog, ads, branding, seo, copy, diseño, video).",
      user: `Tarea: ${title}\n${description ? "Descripción: " + description + "\n" : ""}
Etiquetas existentes en el workspace (preferir reutilizarlas si encajan): ${existingNames.slice(0, 30).join(", ") || "ninguna"}

Devuelve JSON con clave "tags": array de strings.`,
      schema: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 }
        },
        required: ["tags"],
        additionalProperties: false
      }
    });
    return NextResponse.json({ tags: result.tags });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }
});
