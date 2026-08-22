export type BusinessContactKind = "website" | "instagram" | "facebook" | "tiktok" | "whatsapp";

type Media = { coverImageUrl?: string | null; logoUrl?: string | null };

export function resolveBusinessHero(media: Media) {
  return { heroUrl: media.coverImageUrl || null, logoUrl: media.logoUrl || null };
}

export function businessDiscountCopy(discountPct?: number | null) {
  if (!discountPct || discountPct <= 0) return null;
  return {
    badge: `-${discountPct}%`,
    title: `Ahorra un ${discountPct}% en este negocio`,
    detail: "Presenta y canjea tu cupón Bubui para obtener el descuento.",
  };
}

export function couponExpiryCopy(hoursLeft?: number | null) {
  if (hoursLeft == null) return null;
  const days = Math.max(1, Math.ceil(hoursLeft / 24));
  return `Tu cupón caduca en ${days} ${days === 1 ? "día" : "días"}`;
}

export function businessContactLinks(input: {
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  whatsapp?: string | null;
}) {
  const rows: Array<{ kind: BusinessContactKind; label: string; url: string }> = [];
  if (input.websiteUrl) rows.push({ kind: "website", label: "Web", url: input.websiteUrl });
  if (input.instagramUrl) rows.push({ kind: "instagram", label: "Instagram", url: input.instagramUrl });
  if (input.facebookUrl) rows.push({ kind: "facebook", label: "Facebook", url: input.facebookUrl });
  if (input.tiktokUrl) rows.push({ kind: "tiktok", label: "TikTok", url: input.tiktokUrl });
  if (input.whatsapp) rows.push({ kind: "whatsapp", label: "WhatsApp", url: `https://wa.me/${input.whatsapp.replace(/\D/g, "")}` });
  return rows;
}
