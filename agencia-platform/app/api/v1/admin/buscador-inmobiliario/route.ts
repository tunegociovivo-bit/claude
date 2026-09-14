import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { businessPremisesSearchSchema } from "@/lib/inmobiliaria/contracts";
import { PORTALS } from "@/lib/inmobiliaria/portals";
import { searchOpportunities } from "@/lib/inmobiliaria/search";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const searchSchema = businessPremisesSearchSchema;

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json({
    portals: PORTALS.map((p) => ({
      key: p.key,
      label: p.label,
      bank: p.bank,
      url: p.url,
      note: p.note ?? null,
      kind: p.kind,
      operations: p.operations,
      fetchMode: p.fetchMode
    }))
  });
});

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  await requireAdmin(api);

  const body = await req.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const result = await searchOpportunities(api.workspaceId, api.userId ?? null, parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    // Surface the real reason (Anthropic/timeout/parse) instead of an opaque
    // "Error interno" so el usuario y los logs vean qué ha fallado.
    const detail = String((e as any)?.error?.message ?? (e as any)?.message ?? e).slice(0, 300);
    console.error("[buscador-inmobiliario] búsqueda fallida:", detail);
    throw new ApiError(502, "search_failed", `No se pudo completar la búsqueda: ${detail}`);
  }
});
