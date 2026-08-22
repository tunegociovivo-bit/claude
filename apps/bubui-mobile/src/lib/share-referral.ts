import { Share } from "react-native";
import { api, API_BASE } from "./api";

/** Opens the native share sheet only after a complete invitation is ready. */
export async function shareReferralForOffer(
  customerId: string,
  offer?: { offerId?: string | null; businessName?: string | null; prize?: string | null; friendsLeft?: number | null }
): Promise<boolean> {
  let code: string | null = null;
  try {
    const r = await api.referral(customerId);
    code = r?.code ?? null;
  } catch {
    return false;
  }

  // A challenge without both identifiers becomes a generic install and loses
  // attribution. Never let that incomplete URL reach WhatsApp.
  if (!code || (offer && !offer.offerId)) return false;
  const link = `${API_BASE}/bubui/r/${code}${offer?.offerId ? `?offer=${encodeURIComponent(offer.offerId)}` : ""}`;

  let message: string;
  if (offer?.prize) {
    const left = offer.friendsLeft && offer.friendsLeft > 0 ? offer.friendsLeft : null;
    message =
      `¡Estoy a punto de conseguir ${offer.prize}` +
      (offer.businessName ? ` en ${offer.businessName}` : "") +
      ` con Bubui! ${left ? `Solo me faltan ${left} amig${left === 1 ? "o" : "os"}. ` : ""}` +
      `Únete con mi enlace y ambos ganamos descuentos en negocios del barrio 🎁 ${link}`;
  } else {
    message = `¡Descubre Bubui y llévate descuentos en negocios del barrio! 🎁 ${link}`;
  }

  try {
    await Share.share({ message, url: link });
    return true;
  } catch {
    return false;
  }
}

export async function remindFriendForOffer(
  customerId: string,
  friendName: string,
  offer: { offerId: string; businessName?: string | null }
): Promise<boolean> {
  let code: string | null = null;
  try { code = (await api.referral(customerId))?.code ?? null; } catch { return false; }
  if (!code || !offer.offerId) return false;
  const link = `${API_BASE}/bubui/r/${code}?offer=${encodeURIComponent(offer.offerId)}`;
  const name = friendName.trim() || "amigo/a";
  const message = `Hola ${name}, te recuerdo el reto de Bubui${offer.businessName ? ` en ${offer.businessName}` : ""}. ` +
    `Te falta usar tu cupón para que ambos consigamos el descuento 🎁 ${link}`;
  try { await Share.share({ message, url: link }); return true; } catch { return false; }
}
