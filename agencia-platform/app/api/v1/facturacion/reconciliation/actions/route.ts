/**
 * POST /api/v1/facturacion/reconciliation/actions
 * Body: { action: "match", transactionId, invoiceId }  → concilia a mano (mismo importe)
 *       { action: "undo", transactionId }              → deshace una conciliación inferida/manual
 *       { action: "ignore", transactionId }            → descarta un movimiento que no es cobro
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { ignoreMovement, manualMatchMovement, undoMovementMatch } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("match"), transactionId: z.string().min(1).max(64), invoiceId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("undo"), transactionId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("ignore"), transactionId: z.string().min(1).max(64) })
]);

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Acción de conciliación no válida");
  const body = parsed.data;
  try {
    if (body.action === "match") await manualMatchMovement(api.workspaceId, body.transactionId, body.invoiceId);
    else if (body.action === "undo") await undoMovementMatch(api.workspaceId, body.transactionId);
    else await ignoreMovement(api.workspaceId, body.transactionId);
  } catch (error: any) {
    throw new ApiError(409, "conflict", error?.message ?? "No se pudo completar la acción");
  }
  return NextResponse.json({ ok: true });
});
