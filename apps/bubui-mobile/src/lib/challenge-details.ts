export function challengePriceCopy(price?: number | null, discountPct = 0) {
  if (price == null) return null;
  const eur = (value: number) => `${value.toFixed(2).replace(".", ",")} €`;
  const savings = Math.round(price * discountPct) / 100;
  return `${eur(price)} · ahorras ${eur(savings)} · pagas ${eur(price - savings)}`;
}

export function challengePriceBreakdown(price?: number | null, discountPct = 0) {
  if (price == null) return null;
  const original = Math.max(0, price);
  const pct = Math.min(100, Math.max(0, discountPct));
  const savings = Math.round(original * pct) / 100;
  return { original, savings, final: Math.max(0, original - savings) };
}

export function formatEuro(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

export function challengeActionCopy(input: {
  mode?: string | null;
  businessName: string;
  address?: string | null;
  inviterName?: string | null;
  recipientName?: string | null;
  serviceTitle?: string | null;
  description?: string | null;
  discountPct?: number | null;
  price?: number | null;
}) {
  if (input.mode === "online") {
    const price = challengePriceBreakdown(input.price, input.discountPct ?? 0);
    const description = input.description?.trim().slice(0, 160);
    const lines = [
      "🎁 *QUIERO ACEPTAR UN RETO DE BUBUI*",
      "",
      `Hola, soy *${input.recipientName?.trim() || "un cliente de Bubui"}*.`,
      `👤 Me invita: ${input.inviterName?.trim() || "un amigo/a"}`,
      `🏪 Negocio: *${input.businessName}*`,
      `🎯 Servicio: *${input.serviceTitle?.trim() || "Reto especial Bubui"}*`,
      description ? `📝 ${description}` : null,
      input.discountPct != null ? `🔥 Descuento: *${input.discountPct}%*` : null,
      price ? "" : null,
      price ? `💶 Precio original: ${formatEuro(price.original)}` : null,
      price ? `✅ Ahorras: *${formatEuro(price.savings)}*` : null,
      price ? `⭐ Precio final: *${formatEuro(price.final)}*` : null,
      "",
      "Quiero aceptar el reto y contratar este servicio con el descuento. ¿Cómo continuamos?",
      "",
      "📲 Enviado desde Bubui",
    ];
    return lines.filter((line): line is string => line !== null).join("\n").slice(0, 900);
  }
  return `Para aceptar el reto, ve a ${input.businessName}${input.address ? ` en ${input.address}` : ""} y escanea el QR del establecimiento.`;
}
