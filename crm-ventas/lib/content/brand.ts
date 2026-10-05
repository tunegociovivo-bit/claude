import { prisma } from "@/lib/prisma";
import { readSettings } from "@/lib/settings";
import { buildS3Key, uploadBuffer, signedDownloadUrl } from "@/lib/storage/r2";
import { resignUrlIfNeeded } from "@/lib/storage/resign";

/** Validez de las URLs de recursos de marca (logo, referencias): 1 año. */
export const ASSET_URL_TTL = 365 * 24 * 60 * 60;
const S3_MAX_TTL = 7 * 24 * 60 * 60;

/**
 * Firma la URL de un recurso de marca con la validez más larga posible: 1 año
 * en BD o con URL pública; S3/R2 sin URL pública no admite más de 7 días (al
 * leer la ficha se vuelve a firmar con resignBrandAssets).
 */
export async function signAssetUrl(key: string): Promise<string> {
  try {
    return await signedDownloadUrl(key, ASSET_URL_TTL);
  } catch {
    return signedDownloadUrl(key, S3_MAX_TTL);
  }
}

/**
 * Devuelve (o crea la primera vez) la ficha de marca del negocio. En el CRM
 * hay una por workspace; se rellena con lo que el negocio ya configuró para
 * Paula (nombre, web, información) y su logo.
 */
export async function ensureContentBrand(workspaceId: string) {
  const existing = await prisma.contentBrand.findUnique({ where: { workspaceId } });
  if (existing) return existing;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, settings: true } });
  if (!ws) throw new Error("Workspace no encontrado");
  const settings = readSettings(ws.settings);
  let logoUrl: string | null = null;
  const dataUrl = settings.branding.logoDataUrl;
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s.exec(dataUrl || "");
  if (m) {
    try {
      const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
      const key = buildS3Key({ workspaceId, targetType: "brand", targetId: "logo", filename: `logo.${ext}` });
      await uploadBuffer({ s3Key: key, body: Buffer.from(m[2], "base64"), contentType: m[1] });
      logoUrl = await signAssetUrl(key);
    } catch (e) {
      console.warn("[content-brand] no se pudo copiar el logo:", (e as Error).message);
    }
  }
  try {
    return await prisma.contentBrand.create({
      data: {
        workspaceId,
        name: settings.sonia.businessName?.trim() || ws.name,
        website: settings.sonia.websiteUrl?.trim() || null,
        infoGeneral: settings.sonia.businessInfo?.trim() || null,
        logoUrl,
      },
    });
  } catch {
    // Carrera entre dos peticiones: la otra ya la creó.
    const again = await prisma.contentBrand.findUnique({ where: { workspaceId } });
    if (again) return again;
    throw new Error("No se pudo crear la ficha de marca");
  }
}

/** Re-firma las URLs de recursos de la ficha para mostrarlas en pantalla. */
export async function resignBrandAssets<T extends Record<string, any>>(brand: T, workspaceId: string): Promise<T> {
  const out: any = { ...brand };
  if (typeof out.logoUrl === "string") out.logoUrl = await resignUrlIfNeeded(out.logoUrl, workspaceId);
  for (const field of ["referenceImages", "patternTemplates", "fonts"]) {
    if (Array.isArray(out[field])) {
      out[field] = await Promise.all(
        out[field].map(async (item: any) =>
          item && typeof item.url === "string" ? { ...item, url: await resignUrlIfNeeded(item.url, workspaceId) } : item
        )
      );
    }
  }
  return out;
}
