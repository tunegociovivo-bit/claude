/**
 * POST /api/v1/admin/bubui/subvenciones/borrador  { businessId, convocatoriaId }
 * Genera con IA un borrador de solicitud de subvención para un comercio de
 * Bubui (lo revisa el humano y lo presenta). #7 auto-solicitud asistida.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generarBorradorBubui } from "@/lib/subvenciones/borrador";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({ businessId: z.string().min(1), convocatoriaId: z.string().min(1) });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const borrador = await generarBorradorBubui(api.workspaceId, parsed.data.businessId, parsed.data.convocatoriaId);
    return NextResponse.json({ ok: true, borrador });
  } catch (e: any) {
    throw new ApiError(400, "borrador_error", e?.message ?? "No se pudo generar el borrador.");
  }
});
