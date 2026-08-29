import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeProspectingActivity, markProspectingProspectReplied } from "@/lib/leads/prospecting-engine";

const schema = z.object({ activityId: z.string().min(1).optional(), prospectId: z.string().min(1).optional(), action: z.enum(["complete", "replied"]).default("complete") })
  .refine((value) => Boolean(value.activityId || value.prospectId), "Falta activityId o prospectId");

export const PATCH = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const activity = parsed.data.prospectId && parsed.data.action === "replied"
    ? await markProspectingProspectReplied(api.workspaceId, parsed.data.prospectId)
    : parsed.data.activityId
      ? await completeProspectingActivity(api.workspaceId, parsed.data.activityId, parsed.data.action)
      : null;
  if (!activity) throw new ApiError(404, "not_found", "Acción pendiente no encontrada");
  return NextResponse.json({ ok: true });
});
