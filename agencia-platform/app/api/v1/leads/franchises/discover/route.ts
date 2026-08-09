/**
 * Módulo Franquicias — descubrir marcas de un nicho (verificadas contra Places).
 *
 *  POST { niche } → { brands: [{ name, sampleCount }] }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { discoverFranchiseBrands } from "@/lib/leads/sources/franchises";

export const dynamic = "force-dynamic";

const schema = z.object({ niche: z.string().min(2).max(120) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const res = await discoverFranchiseBrands(api.workspaceId, parsed.data.niche.trim());
  return NextResponse.json(res);
});
