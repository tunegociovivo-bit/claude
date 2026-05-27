import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { enrollLeadInSequence } from "@/lib/leads/sequences";

const schema = z.object({
  leadId: z.string().min(1),
  sequenceId: z.string().min(1)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const out = await enrollLeadInSequence({
      workspaceId: api.workspaceId,
      leadId: parsed.data.leadId,
      sequenceId: parsed.data.sequenceId
    });
    return NextResponse.json(out);
  } catch (e: any) {
    throw new ApiError(400, "enroll_error", e?.message ?? "Error enrolando lead");
  }
});
