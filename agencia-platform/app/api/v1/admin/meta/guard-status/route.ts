import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getMetaGuardState } from "@/lib/integrations/meta-rate-guard";

export const dynamic = "force-dynamic";

// Estado de solo lectura: lo puede ver cualquier usuario del workspace
// (sale en todas las pantallas relacionadas con Meta), no solo admins.
export const GET = withApi({ scope: "*" }, async () => {
  const state = await getMetaGuardState();
  return NextResponse.json(state);
});
