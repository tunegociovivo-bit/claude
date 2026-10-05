/**
 * POST /api/v1/brand/analyze-website
 * Body: { url?, save? }
 *
 * Llama a Claude para extraer summary, colores y fuentes de la web pública
 * de la marca. Si save=true, guarda web y colores en la ficha de marca.
 * Portado de app/api/v1/clients/[id]/analyze-website del Hub.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeClientWebsite } from "@/lib/editorial/analyze-client";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";
import { ensureContentBrand } from "@/lib/content/brand";

export const dynamic = "force-dynamic";

const withProtocol = (value: unknown) =>
  typeof value === "string" && value.trim() && !/^https?:\/\//i.test(value.trim()) ? `https://${value.trim()}` : value;

const schema = z.object({
  url: z.preprocess(withProtocol, z.string().url().optional()),
  save: z.boolean().default(false)
});

export const POST = withApi({ module: "editorial", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const brand = await ensureContentBrand(api.workspaceId);

  const url = parsed.data.url ?? (withProtocol(brand.website) as string | null);
  if (!url) throw new ApiError(400, "no_url", "No hay web de tu marca. Escríbela primero.");

  try {
    const out = await analyzeClientWebsite({ workspaceId: api.workspaceId, url });

    if (parsed.data.save) {
      await prisma.contentBrand.updateMany({
        where: { id: brand.id, workspaceId: api.workspaceId },
        data: {
          website: url,
          brandColorPrimary: out.brandColors.primary,
          brandColorAccent: out.brandColors.accent,
          brandColorText: out.brandColors.text
        }
      });
    }

    return NextResponse.json({ ...out, url, saved: parsed.data.save });
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (String(e?.message ?? "").startsWith("No se pudo leer la web")) throw new ApiError(400, "website_unreachable", e.message);
    console.error("[analyze-website] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
