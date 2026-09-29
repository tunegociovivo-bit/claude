export function friendChallengeMessage(input: {
  business: { name: string };
  contact: { name?: string | null; phone: string };
  rewardLabel?: string | null;
  challengeInviterName?: string | null;
  challengeServiceDescription?: string | null;
  challengeServicePrice?: number | null;
  discountPct: number;
}) {
  const price = input.challengeServicePrice;
  const savings = price == null ? null : Math.round(price * Math.min(100, Math.max(0, input.discountPct))) / 100;
  const eur = (value: number) => `${value.toFixed(2).replace(".", ",")} €`;
  return [
    "🎁 *QUIERO ACEPTAR UN RETO DE BUBUI*",
    `Hola, soy *${input.contact.name?.trim() || "un cliente de Bubui"}*.`,
    `📞 Mi teléfono: ${input.contact.phone}`,
    `👤 Me invita: ${input.challengeInviterName || "un amigo/a"}`,
    `🏪 Negocio: *${input.business.name}*`,
    `🎯 Servicio: *${input.rewardLabel || "Reto especial Bubui"}*`,
    input.challengeServiceDescription?.slice(0, 160),
    `🔥 Descuento: *${input.discountPct}%*`,
    price != null ? `💶 Precio original: ${eur(price)}` : null,
    savings != null ? `✅ Ahorras: *${eur(savings)}*` : null,
    price != null && savings != null ? `⭐ Precio final: *${eur(Math.max(0, price - savings))}*` : null,
    "Quiero aceptar el reto y contratar este servicio con el descuento. ¿Cómo continuamos?",
    "📲 Enviado desde Bubui"
  ].filter(Boolean).join("\n");
}
