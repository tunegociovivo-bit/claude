import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { readModules } from "@/lib/modules";
import { hashPairToken, PAIR_TTL_MS } from "@/lib/seo-blog/pair";
import { rateLimitPublic } from "@/lib/seo-blog/public-rate-limit";
import { hostOf } from "@/lib/seo-blog/util";
import { normalizeSiteUrl, wpTest } from "@/lib/seo-blog/wp";
import { getSiteCtx, sitePages } from "@/lib/seo-blog/service";
import { z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  siteId: z.string().min(1).max(64),
  token: z.string().min(16).max(128),
  user: z.string().min(1).max(200),
  appPassword: z.string().min(8).max(200),
  siteUrl: z.string().min(4).max(500),
  wpVersion: z.string().max(40).optional(),
  bridge: z.string().max(40).optional()
});

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Lo llama el plugin NV SEO Bridge (desde la web del negocio) con el código de conexión pegado
 * en WordPress. Recibe las credenciales recién creadas por el plugin, las guarda cifradas y
 * comprueba la conexión. Seguridad: token de un solo uso (solo se guarda su hash SHA-256),
 * caducidad de 24 h, límite de intentos por IP y el módulo «seo» debe estar activo.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimitPublic(req, { tag: "seo-blog-pair", limit: 20 });
  if (limited) return limited;
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "Faltan datos en la petición del plugin.");
  const b = parsed.data;
  const wpUser = b.user.trim();
  const appPassword = b.appPassword.trim();
  const siteUrl = normalizeSiteUrl(b.siteUrl);
  if (!wpUser || !appPassword || !/^https?:\/\//i.test(siteUrl)) return fail(400, "Faltan datos en la petición del plugin.");

  const site = await prisma.seoBlogSite.findFirst({ where: { id: b.siteId } });
  if (!site || !site.pairTokenHash || !sameHash(site.pairTokenHash, hashPairToken(b.token))) {
    return fail(401, "El código de conexión no es válido. Genera uno nuevo en Negocio Vivo (Blog SEO → Web y conexión).");
  }
  if (!site.pairTokenAt || Date.now() - site.pairTokenAt.getTime() > PAIR_TTL_MS) {
    return fail(401, "El código de conexión ha caducado. Genera uno nuevo en Negocio Vivo (Blog SEO → Web y conexión).");
  }
  const ws = await prisma.workspace.findFirst({ where: { id: site.workspaceId }, select: { isBlocked: true, settings: true } });
  if (!ws || ws.isBlocked || !readModules(ws.settings).seo) {
    return fail(403, "El Publicador SEO no está activo en esta cuenta. Avisa a Negocio Vivo.");
  }

  // El token es de un solo uso: se consume de forma atómica (dos peticiones con el mismo código → solo una gana).
  const claimed = await prisma.seoBlogSite.updateMany({
    where: { id: site.id, workspaceId: site.workspaceId, pairTokenHash: site.pairTokenHash },
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
  if (claimed.count !== 1) return fail(401, "El código de conexión ya se ha usado. Genera uno nuevo en Negocio Vivo.");

  const ctx = await getSiteCtx(site.workspaceId, site.id);
  if (!ctx) return fail(404, "Web no encontrada.");
  const before = hostOf(site.siteUrl);
  const changedHost = before && before !== hostOf(siteUrl) ? ` (la web pasa de ${before} a ${hostOf(siteUrl)})` : "";
  try {
    const t = await wpTest(ctx);
    const pages = await sitePages(ctx, true).catch(() => []);
    return NextResponse.json({
      ok: true,
      message: `Conectado con Negocio Vivo como ${t.user}. ${pages.length} páginas/posts indexados.${changedHost}`,
      user: t.user,
      canPublish: t.canPublish,
      canUpload: t.canUpload
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `Credenciales guardadas, pero la comprobación falló: ${e?.message ?? String(e)}` }, { status: 200 });
  }
}
