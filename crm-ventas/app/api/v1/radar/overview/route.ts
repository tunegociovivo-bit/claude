import { requireRadarUser, radarError } from "@/lib/radar/api";
import { listSources } from "@/lib/radar/sources";
import { listSearches } from "@/lib/radar/searches";
import { getRadarConfig } from "@/lib/radar/settings";
import { radarCounts } from "@/lib/radar/listings-query";
import { radarBrowserConfigured } from "@/lib/radar/browser";
import { PORTAL_FIELD_OPTIONS } from "@/lib/radar/options";

export const dynamic = "force-dynamic";

// Todo lo que necesita la pantalla del radar en una sola llamada.
export async function GET() {
  try {
    const user = await requireRadarUser();
    const [sources, searches, config, counts] = await Promise.all([
      listSources(user.workspaceId),
      listSearches(user.workspaceId),
      getRadarConfig(user.workspaceId),
      radarCounts(user.workspaceId),
    ]);
    return Response.json({
      isAdmin: user.isAdmin,
      browserReady: radarBrowserConfigured(),
      sources,
      searches,
      config,
      counts,
      options: PORTAL_FIELD_OPTIONS,
    });
  } catch (error) {
    return radarError(error);
  }
}
