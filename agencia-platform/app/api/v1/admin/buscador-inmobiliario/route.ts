import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { PORTALS, PORTAL_KEYS } from "@/lib/inmobiliaria/portals";
import { searchOpportunities } from "@/lib/inmobiliaria/search";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const searchSchema = z.object({
  location: z.string().min(2).max(160),
  propertyType: z.string().max(60).optional(),
  objective: z.string().max(60).optional(),
  occupancy: z.enum(["any", "occupied", "free"]).optional(),
  minPrice: z.number().int().nonnegative().optional(),
  maxPrice: z.number().int().positive().optional(),
  minSurface: z.number().int().positive().optional(),
  portals: z.array(z.enum(PORTAL_KEYS as [string, ...string[]])).optional(),
  maxResults: z.number().int().min(1).max(30).optional(),
  onlyOpportunities: z.boolean().optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api);
  return NextResponse.json({
    portals: PORTALS.map((p) => ({
      key: p.key,
      label: p.label,
      bank: p.bank,
      url: p.url,
      note: p.note ?? null
    }))
  });
});

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  await requireAdmin(api);

  const body = await req.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const result = await searchOpportunities(api.workspaceId, api.userId ?? null, {
      location: parsed.data.location.trim(),
      propertyType: parsed.data.propertyType?.trim() || undefined,
      objective: parsed.data.objective?.trim() || undefined,
      occupancy: parsed.data.occupancy ?? "any",
      minPrice: parsed.data.minPrice,
      maxPrice: parsed.data.maxPrice,
      minSurface: parsed.data.minSurface,
      portals: parsed.data.portals ?? [],
      maxResults: parsed.data.maxResults ?? 12,
      onlyOpportunities: parsed.data.onlyOpportunities ?? false
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }
});
