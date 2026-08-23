import { buildChallengeFollowupDetail } from "./challenge-followup-detail";

export type ChallengeFollowupMessageInput = {
  businessName: string;
  friendName: string;
  challengeTitle?: string | null;
  serviceDescription?: string | null;
  serviceMode?: string | null;
  originalPrice?: number | null;
  discountPct?: number | null;
  expiresAt?: string | null;
  second: boolean;
  reviewUrl: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

const euro = (value: number) => value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildChallengeFollowupMessage(input: ChallengeFollowupMessageInput) {
  const title = input.challengeTitle || input.serviceDescription || "Reto Bubui";
  const discount = input.discountPct && input.discountPct > 0 ? `${input.discountPct}%` : "Consulta las condiciones del reto";
  const commercial = buildChallengeFollowupDetail({ originalPrice: input.originalPrice, discountPct: input.discountPct });
  const details = [
    input.serviceDescription && input.serviceDescription !== title ? `📝 Descripción: ${input.serviceDescription}` : null,
    input.serviceMode ? `📲 Modalidad: ${input.serviceMode}` : null,
    commercial.originalPrice != null ? `💶 Precio original: ${euro(commercial.originalPrice)} €` : null,
    commercial.savings != null ? `✨ Ahorro: ${euro(commercial.savings)} €` : null,
    commercial.finalPrice != null ? `✅ Precio final: ${euro(commercial.finalPrice)} €` : null,
    input.expiresAt ? `📅 Vigente hasta: ${new Date(input.expiresAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}` : null,
  ].filter(Boolean) as string[];
  const question = input.second
    ? `¿${input.friendName} ha contratado ya el servicio del reto?`
    : `¿${input.friendName} ha contratado el servicio con el descuento del reto?`;
  const subject = `🎯 ¿${input.friendName} contrató el reto de ${input.businessName}?`;
  const text = [
    "🎯 SEGUIMIENTO DE RETO · BUBUI",
    "━━━━━━━━━━━━━━━━━━",
    `👤 Cliente: ${input.friendName}`,
    `🏪 Negocio: ${input.businessName}`,
    `🎁 Servicio/reto: ${title}`,
    `💗 Descuento solicitado: ${discount}`,
    ...details,
    "",
    question,
    "",
    "✅ SÍ · ❌ NO · ⏳ TODAVÍA NO",
    `Responde en la ficha exacta: ${input.reviewUrl}`,
  ].join("\n");
  const detailsHtml = details.map((line) => `<div style="margin-top:8px">${escapeHtml(line)}</div>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#fff5f9;font-family:Arial,sans-serif;color:#20202a"><div style="max-width:620px;margin:24px auto;padding:12px"><div style="background:linear-gradient(135deg,#ec3b91,#7c3aed);border-radius:24px 24px 0 0;padding:28px;color:white;text-align:center"><div style="font-size:13px;font-weight:800;letter-spacing:1.5px">BUBUI · SEGUIMIENTO DE RETO</div><h1 style="margin:12px 0 4px;font-size:28px">¿Ha contratado el servicio?</h1><p style="margin:0;opacity:.9">Revisa el caso concreto y responde</p></div><div style="background:white;border:1px solid #f5c4dc;border-top:0;border-radius:0 0 24px 24px;padding:28px;box-shadow:0 8px 28px #d62a7718"><div style="background:#fff3f8;border-radius:16px;padding:18px"><div style="font-size:22px;font-weight:800">${escapeHtml(input.friendName)}</div><div style="margin-top:5px;color:#666">${escapeHtml(input.businessName)}</div><div style="margin-top:14px;font-weight:700">🎁 ${escapeHtml(title)}</div><div style="margin-top:8px;color:#c21867;font-size:20px;font-weight:900">${escapeHtml(discount)}</div>${detailsHtml}</div><p style="font-size:18px;line-height:1.45;margin:24px 0;text-align:center">${escapeHtml(question)}</p><a href="${escapeHtml(input.reviewUrl)}" style="display:block;background:#e8328a;color:white;text-decoration:none;text-align:center;padding:17px;border-radius:999px;font-weight:800;font-size:17px">Responder ahora en este seguimiento</a><div style="display:flex;gap:8px;margin-top:14px;text-align:center"><span style="flex:1;background:#e8f8ef;color:#168347;padding:10px;border-radius:10px;font-weight:700">✅ Sí</span><span style="flex:1;background:#fff0f0;color:#bb2d3b;padding:10px;border-radius:10px;font-weight:700">❌ No</span><span style="flex:1;background:#fff7df;color:#8a6500;padding:10px;border-radius:10px;font-weight:700">⏳ Todavía no</span></div></div></div></body></html>`;
  return { subject, text, html, question };
}
