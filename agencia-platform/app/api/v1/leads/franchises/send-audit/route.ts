import { NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { buildFranchiseAuditSvg, type FranchiseAudit } from "@/lib/leads/franchise-audit";
import { sendEmailWithAttachment } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().min(1),
  subject: z.string().min(3).max(240).optional(),
  body: z.string().min(20).max(8000).optional()
});

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({ where: { id: parsed.data.id, workspaceId: api.workspaceId, contactStatus: { not: "excluded" } }, select: { id: true, name: true, email: true, rawData: true } });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");
  if (!lead.email) throw new ApiError(400, "missing_email", "La central no tiene un email destinatario");
  const raw: any = lead.rawData ?? {};
  const selectedDecisionMaker = raw.decisionMakerResearch?.selected;
  if (!selectedDecisionMaker?.sendAllowed || selectedDecisionMaker.email?.toLowerCase() !== lead.email.toLowerCase()) {
    throw new ApiError(409, "decision_maker_unverified", "Investiga y verifica primero al responsable de marketing de la central");
  }
  const audit = raw.franchiseAudit as FranchiseAudit | undefined;
  if (!audit?.metrics) throw new ApiError(400, "missing_audit", "Analiza la red antes de enviar la auditoría");

  const svg = buildFranchiseAuditSvg(audit);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const publicToken = raw.franchiseGrowth?.publicAudit?.token;
  const publicAuditUrl = publicToken ? `${new URL(req.url).origin}/auditoria/franquicia/${publicToken}` : null;
  const subject = parsed.data.subject?.trim() || `${lead.name}: hallazgos observados en su red local`;
  const draftBody = parsed.data.body?.trim() || `Hola${raw.directorName ? ` ${raw.directorName}` : ""},\n\nHemos analizado una muestra de ${audit.metrics.sampled} ubicaciones públicas de ${lead.name}. Hemos encontrado ${audit.findings.length} áreas que merece la pena revisar, especialmente: ${audit.findings[0]?.title?.toLowerCase() ?? "la desigualdad entre unidades"}.\n\nAdjunto una visualización resumida y claramente identificada como simulación basada en datos observados. La propuesta no es auditar por auditar: planteamos un piloto de 60 días sobre varias unidades y un grupo de control.\n\n¿Le encaja revisarlo durante 15 minutos?\n\nDavid\nNegocio Vivo`;
  const body = `${draftBody}${publicAuditUrl ? `\n\nAuditoría privada y piloto: ${publicAuditUrl}` : ""}`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a">${draftBody.split(/\n+/).map((line) => `<p>${esc(line)}</p>`).join("")}${publicAuditUrl ? `<p><a href="${esc(publicAuditUrl)}" style="display:inline-block;background:#4f46e5;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Abrir auditoría privada y piloto</a></p>` : ""}<div style="margin-top:20px;padding:14px;border-radius:10px;background:#f8fafc"><strong>${esc(audit.offer.title)}</strong><br>${esc(audit.offer.pilot)}</div><p style="font-size:12px;color:#64748b">La auditoría describe una muestra pública observada. No contiene estimaciones de ingresos ni presenta la simulación visual como una captura literal de una plataforma.</p></div>`;
  const out = await sendEmailWithAttachment({
    workspaceId: api.workspaceId,
    to: lead.email,
    bcc: Array.isArray(raw.decisionMakerResearch?.copies)
      ? raw.decisionMakerResearch.copies.filter((candidate: any) => candidate?.copyAllowed && candidate?.email).slice(0, 4).map((candidate: any) => candidate.email)
      : undefined,
    subject,
    html,
    text: body,
    attachment: { filename: `auditoria-${lead.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, content: png, contentType: "image/png" }
  });
  const now = new Date().toISOString();
  const history = Array.isArray(raw.franchisePipeline?.history) ? raw.franchisePipeline.history : [];
  const cadence = Array.isArray(raw.franchiseGrowth?.cadence) ? raw.franchiseGrowth.cadence.map((step: any, index: number) => index === 0 ? { ...step, status: "completed", completedAt: now } : step) : undefined;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { contactStatus: lead.email ? "contacted" : undefined, rawData: { ...raw, franchiseGrowth: raw.franchiseGrowth ? { ...raw.franchiseGrowth, cadence } : undefined, franchisePipeline: { ...raw.franchisePipeline, stage: "audit_sent", updatedAt: now, lastEmailId: out.id, history: [...history, { stage: "audit_sent", at: now, emailId: out.id }].slice(-100) } } }
  });
  return NextResponse.json({ ok: true, emailId: out.id, stage: "audit_sent" });
});
