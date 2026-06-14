/**
 * Banner del Home de Bubui, gestionable desde el panel admin.
 * Se guarda como JSON en BubuiSetting (clave "home_banner").
 *
 * Tipos de destino al tocar el banner (`kind`):
 *   - "link"     → abre una URL externa (comportamiento clásico).
 *   - "business" → promociona un comercio: al tocar se abre su ficha con la
 *                  oferta (pantalla Negocio de la app).
 *   - "promo"    → promoción interna: al tocar se abre una ficha con el mismo
 *                  formato que una oferta, con título/descripción/CTA propios.
 */

import { prisma } from "@/lib/db/prisma";

export type HomeBannerKind = "link" | "business" | "promo";

export type HomeBanner = {
  imageUrl: string; // URL pública de la imagen (vacío = usar el banner por defecto de la app)
  active: boolean;
  kind: HomeBannerKind;
  // kind="link"
  link: string;
  // kind="business"
  businessId: string;
  // kind="promo" (promoción interna)
  promoTitle: string;
  promoCategory: string;
  promoDescription: string;
  promoDiscountPct: number | null;
  promoCtaLabel: string;
  promoCtaLink: string;
};

const KEY = "home_banner";

const EMPTY: HomeBanner = {
  imageUrl: "",
  active: false,
  kind: "link",
  link: "",
  businessId: "",
  promoTitle: "",
  promoCategory: "",
  promoDescription: "",
  promoDiscountPct: null,
  promoCtaLabel: "",
  promoCtaLink: ""
};

function normalize(v: any): HomeBanner {
  const kind: HomeBannerKind = v?.kind === "business" || v?.kind === "promo" ? v.kind : "link";
  const pct = v?.promoDiscountPct;
  return {
    imageUrl: typeof v?.imageUrl === "string" ? v.imageUrl : "",
    active: !!v?.active,
    kind,
    link: typeof v?.link === "string" ? v.link : "",
    businessId: typeof v?.businessId === "string" ? v.businessId : "",
    promoTitle: typeof v?.promoTitle === "string" ? v.promoTitle : "",
    promoCategory: typeof v?.promoCategory === "string" ? v.promoCategory : "",
    promoDescription: typeof v?.promoDescription === "string" ? v.promoDescription : "",
    promoDiscountPct: typeof pct === "number" && Number.isFinite(pct) ? pct : null,
    promoCtaLabel: typeof v?.promoCtaLabel === "string" ? v.promoCtaLabel : "",
    promoCtaLink: typeof v?.promoCtaLink === "string" ? v.promoCtaLink : ""
  };
}

export async function getHomeBanner(): Promise<HomeBanner> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  if (!row) return { ...EMPTY };
  try {
    return normalize(JSON.parse(row.value));
  } catch {
    return { ...EMPTY };
  }
}

export async function setHomeBanner(b: Partial<HomeBanner>): Promise<HomeBanner> {
  const merged = normalize({ ...EMPTY, ...b });
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) }
  });
  return getHomeBanner();
}
