/**
 * POST /api/v1/admin/bubui/subvenciones/[id]
 * Body: { action: "approve" | "reject" }
 *
 * approve → envía las subvenciones al comercio (WhatsApp + email) con el
 *           enlace de validación de un clic.
 * reject  → descarta la propuesta (no se envía nada).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { approveAndSendProposal, rejectProposal } from "@/lib/bubui/subvenciones";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export const POST = withApi({ scope: "*" }, async (req, { params }) => {
  const id = params?.id as string;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  if (parsed.data.action === "reject") {
    await rejectProposal(id);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  const r = await approveAndSendProposal(id);
  if (!r.ok) throw new ApiError(400, "approve_failed", r.error ?? "No se pudo aprobar");
  return NextResponse.json({ ok: true, status: "sent", whatsapp: r.whatsapp, email: r.email });
});
