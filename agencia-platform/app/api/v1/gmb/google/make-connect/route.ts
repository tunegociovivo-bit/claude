/**
 * POST /api/v1/gmb/google/make-connect — enlace para conectar una cuenta de Google (la del
 * cliente) mediante Make: se abre, se inicia sesión con esa cuenta y Make crea la conexión con
 * su app de Google aprobada. Al volver, la cuenta aparece en /api/v1/gmb/google/sources.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { makeCreateCredentialRequest } from "@/lib/integrations/make";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const label = String(body?.label ?? "").trim().slice(0, 80);
  try {
    const r = await makeCreateCredentialRequest(api.workspaceId, {
      name: "Vincular Perfil de Empresa de Google con el GMB Hub",
      description: "Inicia sesión con la cuenta de Google propietaria o administradora de las fichas para vincularlas con el GMB Hub.",
      appName: "google-my-business",
      appVersion: 1,
      nameOverride: `GBP · ${label || "Hub"} · ${new Date().toISOString().slice(0, 10)}`
    });
    return NextResponse.json({ ok: true, url: r.url, id: r.id });
  } catch (e: any) {
    throw new ApiError(502, "make_error", `No se pudo crear el enlace de conexión en Make: ${String(e?.message ?? e).slice(0, 240)}`);
  }
});
