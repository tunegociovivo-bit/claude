export type ChallengeFollowupMessageInput = {
  businessName: string;
  friendName: string;
  challengeTitle?: string | null;
  discountPct?: number | null;
  second: boolean;
  reviewUrl: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildChallengeFollowupMessage(input: ChallengeFollowupMessageInput) {
  const business = escapeHtml(input.businessName);
  const friend = escapeHtml(input.friendName);
  const title = escapeHtml(input.challengeTitle || "Descuento especial Bubui");
  const discount = input.discountPct && input.discountPct > 0 ? `${input.discountPct}%` : "un descuento especial";
  const question = input.second
    ? `¿${input.friendName} ha contratado ya el servicio del reto?`
    : `¿${input.friendName} ha contratado el servicio con el descuento del reto?`;
  const subject = `🎯 ¿${input.friendName} contrató el reto de ${input.businessName}?`;
  const text = [
    `🎯 SEGUIMIENTO DE RETO · BUBUI`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 Cliente: ${input.friendName}`,
    `🏪 Negocio: ${input.businessName}`,
    `🎁 Servicio/reto: ${input.challengeTitle || "Descuento especial Bubui"}`,
    `💗 Descuento: ${discount}`,
    "",
    question,
    "",
    `✅ SÍ · ❌ NO · ⏳ TODAVÍA NO`,
    `Responde desde tu panel: ${input.reviewUrl}`
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#fff5f9;font-family:Arial,sans-serif;color:#20202a"><div style="max-width:620px;margin:24px auto;padding:12px"><div style="background:linear-gradient(135deg,#ec3b91,#7c3aed);border-radius:24px 24px 0 0;padding:28px;color:white;text-align:center"><div style="font-size:13px;font-weight:800;letter-spacing:1.5px">BUBUI · SEGUIMIENTO DE RETO</div><h1 style="margin:12px 0 4px;font-size:28px">¿Ha contratado el servicio?</h1><p style="margin:0;opacity:.9">Han pasado 24 horas desde que aceptó el reto</p></div><div style="background:white;border:1px solid #f5c4dc;border-top:0;border-radius:0 0 24px 24px;padding:28px;box-shadow:0 8px 28px #d62a7718"><div style="background:#fff3f8;border-radius:16px;padding:18px"><div style="font-size:22px;font-weight:800">${friend}</div><div style="margin-top:5px;color:#666">${business}</div><div style="margin-top:14px;font-weight:700">🎁 ${title}</div><div style="margin-top:8px;color:#c21867;font-size:20px;font-weight:900">${discount}</div></div><p style="font-size:18px;line-height:1.45;margin:24px 0;text-align:center">${escapeHtml(question)}</p><a href="${escapeHtml(input.reviewUrl)}" style="display:block;background:#e8328a;color:white;text-decoration:none;text-align:center;padding:17px;border-radius:999px;font-weight:800;font-size:17px">Responder ahora</a><div style="display:flex;gap:8px;margin-top:14px;text-align:center"><span style="flex:1;background:#e8f8ef;color:#168347;padding:10px;border-radius:10px;font-weight:700">✅ Sí</span><span style="flex:1;background:#fff0f0;color:#bb2d3b;padding:10px;border-radius:10px;font-weight:700">❌ No</span><span style="flex:1;background:#fff7df;color:#8a6500;padding:10px;border-radius:10px;font-weight:700">⏳ Todavía no</span></div><p style="margin:22px 0 0;color:#777;font-size:12px;text-align:center">Tus respuestas actualizan automáticamente el progreso del reto.</p></div></div></body></html>`;
  return { subject, text, html, question };
}
