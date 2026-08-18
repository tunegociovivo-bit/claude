function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

export function buildNegativeCommentEmail(input: { clientName: string; campaignName?: string | null; author?: string | null; message: string; url: string; negative?: boolean }) {
  const negative = input.negative !== false;
  const client = escapeHtml(input.clientName);
  const campaign = escapeHtml(input.campaignName || "Campaña de Meta");
  const author = escapeHtml(input.author || "Usuario de Meta");
  const message = escapeHtml(input.message);
  const url = escapeHtml(input.url);
  const heading = negative ? "Nuevo comentario negativo" : "Nuevo comentario";
  return {
    subject: `${negative ? "⚠️ Comentario negativo" : "💬 Nuevo comentario"} · ${input.clientName}`,
    html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid ${negative ? "#fecdd3" : "#cbd5e1"};border-radius:16px;padding:24px"><div style="font-size:13px;font-weight:700;color:${negative ? "#be123c" : "#334155"};text-transform:uppercase">${negative ? "Alerta de reputación" : "Nuevo comentario en Meta"}</div><h1 style="font-size:22px;margin:8px 0 18px">${heading}</h1><p style="margin:0 0 6px"><b>Cliente:</b> ${client}</p><p style="margin:0 0 6px"><b>Campaña:</b> ${campaign}</p><p style="margin:0 0 18px"><b>Autor:</b> ${author}</p><div style="background:${negative ? "#fff1f2" : "#f8fafc"};border-radius:10px;padding:16px;white-space:pre-wrap">${message}</div><p style="margin:22px 0 0"><a href="${url}" style="display:inline-block;background:${negative ? "#e11d48" : "#334155"};color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">Revisar, responder o eliminar</a></p><p style="font-size:12px;color:#64748b;margin:18px 0 0">Por seguridad, responder y eliminar requieren iniciar sesión en el Hub.</p></div></div></body></html>`,
    text: `${negative ? "ALERTA: comentario negativo" : "NUEVO COMENTARIO"}\nCliente: ${input.clientName}\nCampaña: ${input.campaignName || "Campaña de Meta"}\nAutor: ${input.author || "Usuario de Meta"}\n\n${input.message}\n\nRevisar, responder o eliminar: ${input.url}`
  };
}

export function buildMetaOperationalEmail(input: { title: string; detail: string; url: string }) {
  const title = escapeHtml(input.title);
  const detail = escapeHtml(input.detail);
  const url = escapeHtml(input.url);
  return {
    subject: input.title,
    html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:24px"><h1 style="font-size:21px;margin:0 0 16px">${title}</h1><div style="background:#f8fafc;border-radius:10px;padding:16px;white-space:pre-wrap">${detail}</div><p style="margin:22px 0 0"><a href="${url}" style="display:inline-block;background:#334155;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">Abrir comentarios de Meta</a></p></div></div></body></html>`,
    text: `${input.title}\n\n${input.detail}\n\n${input.url}`
  };
}
