import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getMetaGuardState } from "@/lib/integrations/meta-rate-guard";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

// Estado operativo reservado a administradores. Los miembros reciben un
// estado neutro para que clientes antiguos tampoco disparen avisos de voz.
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  // The global voice notifier used this endpoint. Keep non-admin sessions
  // unaware of operational cooldowns so older cached clients also remain
  // silent after this server-side change is deployed.
  if (!(await callerIsAdmin(api))) {
    return NextResponse.json({ inCooldown: false, cooldownUntil: null, cooldownMsLeft: 0 });
  }
  const state = await getMetaGuardState();
  return NextResponse.json(state);
});
