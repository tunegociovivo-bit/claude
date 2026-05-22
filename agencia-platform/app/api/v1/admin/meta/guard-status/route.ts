import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { getMetaGuardState } from "@/lib/integrations/meta-rate-guard";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  await requireAdmin(api);
  const state = await getMetaGuardState();
  return NextResponse.json(state);
});
