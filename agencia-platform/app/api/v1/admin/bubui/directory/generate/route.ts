/**
 * POST /api/v1/admin/bubui/directory/generate
 * Body (opcional): { limit?: number, force?: boolean }
 *
 * Genera con IA la introducción SEO larga de las páginas nicho+localidad del
 * directorio Bubui y la cachea en BubuiDirectoryContent. Las páginas la usan
 * si existe; si no, muestran la plantilla extensa por defecto. Sólo procesa
 * las que aún no tienen contenido (salvo force=true), con un tope por llamada
 * para no agotar el tiempo de ejecución.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { getDirectoryIndex, getListing } from "@/lib/bubui/directory";
import { keyListing } from "@/lib/bubui/editorial";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM = `Eres redactor SEO especializado en negocios locales en España. Escribes en español de España,
con tono cercano, claro y útil. Generas texto ORIGINAL para una página de directorio que lista negocios de un
sector en una localidad concreta (p. ej. "peluquerías en Benalmádena") dentro de Bubui, una app/directorio de
comercios locales donde cada compra da descuentos y desbloquea ofertas cruzadas en otros negocios de la zona.

Reglas:
- Devuelve SOLO el texto, en 3-4 párrafos separados por una línea en blanco. Sin títulos, sin markdown, sin listas.
- Usa de forma natural la consulta "{sector} en {localidad}" y variantes (mejores, cerca de ti, ofertas, descuentos, {provincia}).
- Aporta valor real (cómo elegir, qué ofrece la zona, ventajas de Bubui). Nada de relleno vacío ni promesas falsas.
- No inventes datos concretos (precios, teléfonos) que no te den. Entre 220 y 340 palabras.`;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const body = (await req.json().catch(() => ({}))) as { limit?: number; force?: boolean };
  const limit = Math.min(Math.max(body.limit ?? 12, 1), 40);
  const force = !!body.force;

  const { pairs } = await getDirectoryIndex();

  // Claves ya generadas (para saltarlas salvo force).
  const existing = new Set(
    (await prisma.bubuiDirectoryContent.findMany({ select: { key: true } })).map((r) => r.key)
  );

  let generated = 0;
  const errors: string[] = [];
  for (const p of pairs) {
    if (generated >= limit) break;
    const key = keyListing(p.catSlug, p.citySlug);
    if (!force && existing.has(key)) continue;

    const listing = await getListing(p.catSlug, p.citySlug);
    if (!listing) continue;
    const names = listing.businesses.slice(0, 8).map((b) => b.name).join(", ");
    const user = `Sector: ${listing.category.label} (singular: ${listing.category.singular})
Localidad: ${listing.cityLabel}${listing.province ? ` (${listing.province})` : ""}
Nº de negocios en la página: ${listing.businesses.length}
Algunos negocios: ${names || "—"}

Escribe la introducción SEO para "${listing.category.label} en ${listing.cityLabel}".`;

    try {
      const text = await complete({
        workspaceId: api.workspaceId,
        userId: api.userId ?? null,
        system: SYSTEM,
        user,
        maxTokens: 900,
        feature: "bubui_directory_editorial"
      });
      const intro = text.trim();
      if (!intro) continue;
      await prisma.bubuiDirectoryContent.upsert({
        where: { key },
        create: { key, intro },
        update: { intro }
      });
      generated++;
    } catch (e: any) {
      if (e instanceof AIDisabledError) {
        return NextResponse.json({ error: { code: "ai_disabled", message: "Falta configurar la IA (Anthropic) en el workspace." } }, { status: 400 });
      }
      errors.push(`${key}: ${e?.message ?? "error"}`);
    }
  }

  const pending = pairs.filter((p) => force || !existing.has(keyListing(p.catSlug, p.citySlug))).length - generated;
  return NextResponse.json({ ok: true, generated, pendingApprox: Math.max(0, pending), errors });
});
