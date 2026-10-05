import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";
import { checkFreepikKey } from "@/lib/seo-blog/freepik";

export const dynamic = "force-dynamic";

/** Diagnóstico de la generación de imágenes sin gastar créditos (solo administradores). No revela claves. */
export const GET = withApi({ module: "seo", admin: true, rate: "admin" }, async (_req, { api }) => {
  const s = await getSeoBlogSettings(api.workspaceId);
  const freepik = await checkFreepikKey(api.workspaceId, s);
  return NextResponse.json({ freepik: { ok: freepik.ok, message: freepik.ok ? "Generación de imágenes disponible." : freepik.message } });
});
