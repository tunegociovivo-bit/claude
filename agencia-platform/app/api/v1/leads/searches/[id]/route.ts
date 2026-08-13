/**
 * PATCH /api/v1/leads/searches/[id] — control de una búsqueda (pausar/reanudar/cancelar).
 * body { action: "pause" | "resume" | "cancel" }. Tenant-scoped (workspaceId del solicitante),
 * idempotente y con estado persistente. NO borra leads ya guardados (cancelar solo detiene).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requestSearchControl } from "@/lib/leads/search-control";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const id = String((params as any)?.id ?? "").trim();
  if (!id) throw new ApiError(400, "validation_error", "Falta id");

  const out = await requestSearchControl(prisma, api.workspaceId, id, parsed.data.action);
  if ("notFound" in out) throw new ApiError(404, "not_found", "Búsqueda no encontrada");
  console.info(`[leads/search-control] ws=${api.workspaceId} id=${id} action=${parsed.data.action} → ${out.status} (changed=${out.changed})`);
  return NextResponse.json({ ok: true, id, status: out.status, changed: out.changed });
});
