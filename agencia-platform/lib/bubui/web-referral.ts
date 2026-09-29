export function referralAppUrl(code: string, offerId?: string | null) {
  return `/bubui/app?ref=${encodeURIComponent(code)}${offerId ? `&offer=${encodeURIComponent(offerId)}` : ""}`;
}

export function rememberWebReferral(storage: Pick<Storage, "setItem" | "removeItem">, code: string, offerId?: string | null) {
  storage.setItem("bubui.ref", code);
  if (offerId) storage.setItem("bubui.refOffer", offerId);
  else storage.removeItem("bubui.refOffer");
}

export async function applyPendingWebReferral(customerId: string, storage: Pick<Storage, "getItem" | "removeItem">, headers: Record<string, string>, request: typeof fetch = fetch) {
  const code = storage.getItem("bubui.ref");
  if (!code) return false;
  const offerId = storage.getItem("bubui.refOffer") || undefined;
  const response = await request("/api/bubui/customer/apply-referral", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ customerId, code, offerId })
  });
  if (!response.ok) throw new Error("No se pudo recuperar tu invitación. Vuelve a intentarlo.");
  const result = await response.json();
  if (!result.terminal) throw new Error("Tu invitación sigue pendiente. Vuelve a intentarlo.");
  // Do not erase a newer invitation opened in another tab during this request.
  if (storage.getItem("bubui.ref") === code && (storage.getItem("bubui.refOffer") || undefined) === offerId) {
    storage.removeItem("bubui.ref");
    storage.removeItem("bubui.refOffer");
  }
  return !!result.linked;
}
