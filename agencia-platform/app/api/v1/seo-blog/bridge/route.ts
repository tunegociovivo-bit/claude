import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { NV_SEO_BRIDGE_PHP } from "@/lib/seo-blog/bridge-plugin";

export const dynamic = "force-dynamic";

/** Descarga del plugin NV SEO Bridge (subir a wp-content/plugins/ del cliente y activar). */
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  return new NextResponse(NV_SEO_BRIDGE_PHP, {
    headers: {
      "Content-Type": "application/x-php; charset=utf-8",
      "Content-Disposition": 'attachment; filename="nv-seo-bridge.php"'
    }
  });
});
