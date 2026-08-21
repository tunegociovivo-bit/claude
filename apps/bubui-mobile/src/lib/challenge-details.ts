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
}) {
  if (input.mode === "online") {
    return `Mi amigo/a ${input.inviterName || "de Bubui"} me ha enviado este reto de ${input.businessName} y quiero aceptarlo para disfrutar del descuento.`;
  }
  return `Para aceptar el reto, ve a ${input.businessName}${input.address ? ` en ${input.address}` : ""} y escanea el QR del establecimiento.`;
}
