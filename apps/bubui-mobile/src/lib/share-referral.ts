import { Share } from "react-native";
import { api, API_BASE } from "./api";

/**
 * Abre el menú de compartir con el enlace de invitación del cliente. Si se
 * pasa el contexto de una oferta-reto, el mensaje anima a traer amigos para
 * desbloquearla (motor de crecimiento viral de Bubui).
 */
export async function shareReferralForOffer(
  customerId: string,
  offer?: { offerId?: string | null; businessName?: string | null; prize?: string | null; friendsLeft?: number | null }
): Promise<void> {
  let code: string | null = null;
  try {
    const r = await api.referral(customerId);
    code = r?.code ?? null;
  } catch {
    // sin código seguimos con el enlace genérico
  }
  const link = code
    ? `${API_BASE}/bubui/r/${code}${offer?.offerId ? `?offer=${encodeURIComponent(offer.offerId)}` : ""}`
    : "https://bubui.app";

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
  } catch {
    // cancelado por el usuario
  }
}
