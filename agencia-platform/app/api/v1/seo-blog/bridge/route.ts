import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { withApi } from "@/lib/api/handler";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { NV_SEO_BRIDGE_PHP } from "@/lib/seo-blog/bridge-plugin";

export const dynamic = "force-dynamic";

/** Descarga del plugin NV SEO Bridge como ZIP instalable (Plugins → Añadir nuevo → Subir plugin). */
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  const zip = zipSync({ "nv-seo-bridge/nv-seo-bridge.php": strToU8(NV_SEO_BRIDGE_PHP) }, { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="nv-seo-bridge.zip"'
    }
  });
});
