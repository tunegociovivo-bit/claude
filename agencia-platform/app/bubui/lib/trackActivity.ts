"use client";

/**
 * Registra en el historial del panel admin una acción del cliente en la PWA
 * (compartir una oferta, su enlace de invitación, un reto…).
 *
 * Best-effort: no espera respuesta, nunca lanza y usa `keepalive` para que el
 * envío sobreviva aunque la página navegue a WhatsApp justo después.
 */
import { customerAuthHeaders } from "./customerAuth";

export type BubuiShareType =
  | "offer_shared"
  | "referral_shared"
  | "business_shared"
  | "challenge_link_shared"
  | "challenge_reminder_shared";

export function trackBubuiShare(
  type: BubuiShareType,
  data: { offerId?: string | null; businessId?: string | null; channel?: "whatsapp" | "share_sheet" | "copy" } = {}
): void {
  try {
    const raw = localStorage.getItem("bubui.customer");
    const c = raw ? JSON.parse(raw) : null;
    if (!c?.customerId || !c?.token) return;
    void fetch("/api/bubui/activity", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
      body: JSON.stringify({
        customerId: c.customerId,
        type,
        platform: "web",
        ...(data.offerId ? { offerId: data.offerId } : {}),
        ...(data.businessId ? { businessId: data.businessId } : {}),
        ...(data.channel ? { channel: data.channel } : {})
      })
    }).catch(() => {});
  } catch {
    /* el historial nunca debe romper el compartir */
  }
}
