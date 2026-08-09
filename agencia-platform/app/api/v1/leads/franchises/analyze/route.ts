/**
 * Módulo Franquicias — analizar las marcas seleccionadas.
 *
 *  POST { brands: string[], location? } → { results }
 *  Por cada marca: muestrea su red en Google, genera informe + email a la central,
 *  crea el lead y deja el email en la cola de revisión.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeFranchises } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";

const schema = z.object({
  brands: z.array(z.string().min(1).max(120)).min(1).max(12),
  location: z.string().max(120).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const res = await analyzeFranchises(api.workspaceId, parsed.data.brands, parsed.data.location);
  return NextResponse.json(res);
});
