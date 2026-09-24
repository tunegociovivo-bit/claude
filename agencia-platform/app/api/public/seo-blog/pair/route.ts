import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { encryptSecret } from "@/lib/ai/crypto";
import { hashPairToken, PAIR_TTL_MS } from "@/lib/seo-blog/pair";
import { normalizeSiteUrl, wpTest } from "@/lib/seo-blog/wp";
import { getSiteCtx, sitePages } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lo llama el plugin NV SEO Bridge (desde la web del cliente) con el código de conexión pegado por el usuario.
 * Recibe las credenciales recién creadas por el plugin, las guarda cifradas y comprueba la conexión.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "seo-blog-pair", limit: 20 });
  if (limited) return limited;
  const b = (await req.json().catch(() => ({}))) ?? {};
  const siteId = String(b.siteId ?? "");
  const token = String(b.token ?? "");
  const wpUser = String(b.user ?? "").trim();
  const appPassword = String(b.appPassword ?? "").trim();
  const siteUrl = normalizeSiteUrl(String(b.siteUrl ?? ""));
  if (!siteId || !token || !wpUser || !appPassword || !siteUrl) {
    return NextResponse.json({ ok: false, error: "Faltan datos en la petición del plugin." }, { status: 400 });
  }
  const site = await prisma.seoBlogSite.findUnique({ where: { id: siteId } });
  if (!site || !site.pairTokenHash || site.pairTokenHash !== hashPairToken(token)) {
    return NextResponse.json({ ok: false, error: "El código de conexión no es válido. Genera uno nuevo en el Hub." }, { status: 401 });
  }
  if (!site.pairTokenAt || Date.now() - site.pairTokenAt.getTime() > PAIR_TTL_MS) {
    return NextResponse.json({ ok: false, error: "El código de conexión ha caducado. Genera uno nuevo en el Hub." }, { status: 401 });
  }
  // El token de emparejamiento (hash de un solo uso, 24 h) identifica al sitio; el workspace es el suyo.
  const updated = await prisma.seoBlogSite.update({
    where: { id: site.id, workspaceId: site.workspaceId },
    data: {
      siteUrl,
      wpUser,
      wpAppPasswordEnc: encryptSecret(appPassword),
      pairTokenHash: null,
      pairTokenAt: null,
      pairedAt: new Date(),
      bridgeDetected: true,
      siteCacheAt: null
    }
  });
  try {
    const t = await wpTest(updated);
    const ctx = await getSiteCtx(updated.workspaceId, updated.id);
    const pages = ctx ? await sitePages(ctx, true).catch(() => []) : [];
    return NextResponse.json({
      ok: true,
      message: `Conectado con el Hub Negocio Vivo como ${t.user}. ${pages.length} páginas/posts indexados.`,
      user: t.user,
      canPublish: t.canPublish,
      canUpload: t.canUpload
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Credenciales guardadas, pero la comprobación falló: ${e?.message ?? String(e)}` }, { status: 200 });
  }
}
