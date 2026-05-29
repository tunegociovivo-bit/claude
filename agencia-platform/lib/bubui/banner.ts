/**
 * Banner del Home de Bubui, gestionable desde el panel admin.
 * Se guarda como JSON en BubuiSetting (clave "home_banner").
 */

import { prisma } from "@/lib/db";

export type HomeBanner = {
  imageUrl: string; // URL pública de la imagen (vacío = usar el banner por defecto de la app)
  link: string; // opcional: a dónde lleva al tocar
  active: boolean;
};

const KEY = "home_banner";
const EMPTY: HomeBanner = { imageUrl: "", link: "", active: false };

export async function getHomeBanner(): Promise<HomeBanner> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) return EMPTY;
  try {
    const v = JSON.parse(row.value);
    return {
      imageUrl: typeof v.imageUrl === "string" ? v.imageUrl : "",
      link: typeof v.link === "string" ? v.link : "",
      active: !!v.active
    };
  } catch {
    return EMPTY;
  }
}

export async function setHomeBanner(b: HomeBanner): Promise<HomeBanner> {
  const value = JSON.stringify({ imageUrl: b.imageUrl ?? "", link: b.link ?? "", active: !!b.active });
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value }
  });
  return getHomeBanner();
}
