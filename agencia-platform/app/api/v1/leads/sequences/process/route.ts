import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { processSequencesTick } from "@/lib/leads/sequences";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const out = await processSequencesTick({ workspaceId: api.workspaceId });
  return NextResponse.json(out);
});
