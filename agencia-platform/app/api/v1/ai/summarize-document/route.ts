import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { tiptapToPlainText } from "@/lib/ai/tiptap";

const schema = z.object({
  documentId: z.string(),
  style: z.enum(["bullets", "executive", "tldr"]).default("bullets")
});

const stylePrompts: Record<string, string> = {
  bullets: "Devuelve un resumen en 5-7 viñetas concisas, cada una una idea concreta y accionable.",
  executive: "Devuelve un resumen ejecutivo de 2-3 párrafos pensado para enviar a un cliente o jefe.",
  tldr: "Devuelve un TL;DR de máximo 2 frases."
};

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const doc = await prisma.document.findFirst({
    where: { id: parsed.data.documentId, workspaceId: api.workspaceId }
  });
  if (!doc) throw new ApiError(404, "not_found", "Documento no encontrado");

  const plain = tiptapToPlainText(doc.content);
  if (!plain.trim()) {
    return NextResponse.json({ summary: "El documento está vacío." });
  }

  try {
    const summary = await complete({
      workspaceId: api.workspaceId,
      system:
        "Eres asistente de una agencia de marketing. Resumes documentos internos en español de forma concisa, neutra y accionable. No inventes información.",
      user: `${stylePrompts[parsed.data.style]}\n\n--- DOCUMENTO ---\n${plain}\n--- FIN ---`,
      maxTokens: 1024
    });
    return NextResponse.json({ summary });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }
});
