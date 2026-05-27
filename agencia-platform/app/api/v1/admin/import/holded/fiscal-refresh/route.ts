/**
 * POST /api/v1/admin/import/holded/fiscal-refresh
 *
 * Trae los contactos de Holded y SOLO COMPLETA los datos fiscales (NIF,
 * dirección, etc.) de los clientes que YA existen — no crea ninguno nuevo
 * ni sobrescribe lo que ya tengan. Solo administradores.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { applyClientImport } from "@/lib/import/clients";
import { holdedContactsAsClients } from "@/lib/import/holded-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  try {
    const inputs = await holdedContactsAsClients(api.workspaceId);
    if (inputs.length === 0) {
      throw new ApiError(400, "holded_empty", "Holded no devolvió contactos (¿API key configurada?)");
    }
    const res = await applyClientImport(api.workspaceId, inputs, { onlyExisting: true });
    return NextResponse.json({ ...res, total: inputs.length });
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "holded_error", e?.message ?? "No se pudo conectar con Holded");
  }
});
