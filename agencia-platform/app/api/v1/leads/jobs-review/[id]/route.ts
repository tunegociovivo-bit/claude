/**
 * Módulo Empleos — aprobar / descartar un email en revisión.
 *
 *  POST { action: "approve" | "reject", subject?, body? }
 *   - approve: envía el email (con el texto editado si se pasa) y continúa la
 *     secuencia. reject: descarta el borrador y detiene la secuencia.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { approveExecOutreach, rejectExecOutreach } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  subject: z.string().max(300).optional(),
  body: z.string().max(8000).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  if (parsed.data.action === "reject") {
    await rejectExecOutreach(api.workspaceId, params.id);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  try {
    await approveExecOutreach(api.workspaceId, params.id, { subject: parsed.data.subject, body: parsed.data.body });
  } catch (e: any) {
    throw new ApiError(400, "approve_failed", String(e?.message ?? e));
  }
  return NextResponse.json({ ok: true, status: "sent" });
});
