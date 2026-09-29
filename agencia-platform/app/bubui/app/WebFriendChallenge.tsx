"use client";

import { useState } from "react";
import { customerAuthHeaders } from "@/app/bubui/lib/customerAuth";
import { friendChallengeMessage } from "@/lib/bubui/friend-challenge-message";

type FriendOffer = {
  offerId: string;
  business: { id: string; name: string; phone?: string | null; address?: string | null };
  discountPct: number;
  rewardLabel?: string | null;
  challengeInviterName?: string | null;
  challengeServiceDescription?: string | null;
  challengeServicePrice?: number | null;
  challengeServiceMode?: string | null;
};

export function WebFriendChallenge({ customerId, offer }: { customerId: string; offer: FriendOffer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const online = offer.challengeServiceMode === "online";
  const price = offer.challengeServicePrice;
  const finalPrice = price == null ? null : Math.max(0, price - Math.round(price * Math.min(100, Math.max(0, offer.discountPct))) / 100);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      if (online && !offer.business.phone?.replace(/\D/g, "")) throw new Error("El negocio todavía no ha indicado su teléfono de contacto.");
      const response = await fetch(`/api/bubui/customer/${encodeURIComponent(customerId)}/challenge-contact`, {
        method: "POST", headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
        body: JSON.stringify({ offerId: offer.offerId, channel: online ? "whatsapp" : "qr" })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "No se pudo registrar tu interés.");
      if (online) {
        if (!result.contact?.phone) throw new Error("No se pudo obtener tu teléfono. Vuelve a intentarlo.");
        const message = friendChallengeMessage({ ...offer, contact: result.contact });
        setChatUrl(`https://wa.me/${offer.business.phone!.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`);
      } else {
        window.location.assign(`/bubui/scan/${encodeURIComponent(offer.business.id)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sin conexión. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3 rounded-xl bg-pink-50 p-3 text-sm">
    {offer.challengeInviterName && <p className="font-bold">Te invita {offer.challengeInviterName}</p>}
    {offer.challengeServiceDescription && <p className="mt-1">{offer.challengeServiceDescription}</p>}
    {price != null && <p className="mt-2"><span className="line-through">{price.toFixed(2)} €</span> <strong className="text-pink-700">Pagas {finalPrice?.toFixed(2)} €</strong></p>}
    <p className="mt-2 text-xs">{online ? "El negocio recibirá tu nombre y teléfono para contactarte. Tu amigo avanzará cuando se confirme el pago." : `Acude a ${offer.business.name}${offer.business.address ? `, ${offer.business.address}` : ""} y escanea su QR.`}</p>
    {chatUrl ? <><p className="mt-2 font-semibold">Interés registrado. Envía ahora el mensaje al negocio.</p><a href={chatUrl} target="_blank" rel="noopener noreferrer" className="bubui-btn mt-2 block text-center">Abrir WhatsApp con mis datos</a></> : <button onClick={() => void accept()} disabled={busy} className="bubui-btn mt-2 w-full">{busy ? "Registrando…" : online ? "Aceptar y preparar WhatsApp" : "Aceptar y escanear QR"}</button>}
    {error && <p role="alert" className="mt-2 text-rose-700">{error}</p>}
  </div>;
}
