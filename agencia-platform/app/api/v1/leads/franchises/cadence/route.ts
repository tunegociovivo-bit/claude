import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { completeJson } from "@/lib/ai/anthropic";
import { sendEmail } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";
const schema = z.object({ id: z.string().min(1), index: z.number().int().min(0).max(10), action: z.enum(["draft", "send", "complete"]) });
const emailSchema = { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false } as const;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({ where: { id: parsed.data.id, workspaceId: api.workspaceId }, select: { id: true, name: true, email: true, rawData: true } });
  if (!lead) throw new ApiError(404, "not_found", "Franquicia no encontrada");
  const raw: any = lead.rawData ?? {};
  const cadence = Array.isArray(raw.franchiseGrowth?.cadence) ? [...raw.franchiseGrowth.cadence] : [];
  const step = cadence[parsed.data.index];
  if (!step) throw new ApiError(404, "step_not_found", "Paso de cadencia no encontrado");
  if (["replied", "meeting", "pilot", "proposal", "won", "lost"].includes(raw.franchisePipeline?.stage)) throw new ApiError(409, "cadence_stopped", "La cuenta respondió o cambió de etapa; la cadencia está detenida");

  if (parsed.data.action === "draft") {
    const signals = (raw.franchiseGrowth?.signals ?? []).slice(0, 5).map((signal: any) => `- ${signal.evidence}`).join("\n");
    const output = await completeJson<{ subject: string; body: string }>({
      workspaceId: api.workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: "Redacta seguimientos B2B breves y específicos. Una sola petición. No inventes cifras, noticias ni familiaridad. No repitas el primer correo. Devuelve JSON.",
      user: `Empresa: ${lead.name}\nPersona: ${raw.directorName ?? "responsable de marketing"}\nCargo: ${raw.directorRole ?? "marketing"}\nObjetivo del paso: ${step.purpose}\nSeñales verificadas:\n${signals || "Sin señales externas nuevas; usa solo la auditoría existente."}\nMicrositio: ${raw.franchiseGrowth?.publicAudit?.token ? `${new URL(req.url).origin}/auditoria/franquicia/${raw.franchiseGrowth.publicAudit.token}` : "no disponible"}`,
      schema: emailSchema,
      maxTokens: 600
    });
    cadence[parsed.data.index] = { ...step, status: "draft_ready", draft: output, draftedAt: new Date().toISOString() };
  } else if (parsed.data.action === "send") {
    if (step.channel !== "email") throw new ApiError(400, "wrong_channel", "LinkedIn debe realizarse manualmente");
    if (!lead.email || !raw.decisionMakerResearch?.selected?.sendAllowed) throw new ApiError(409, "decision_maker_unverified", "No hay un decisor verificado");
    if (!step.draft?.subject || !step.draft?.body) throw new ApiError(409, "draft_required", "Genera y revisa primero el borrador");
    const copies = (raw.decisionMakerResearch?.copies ?? []).filter((candidate: any) => candidate.copyAllowed && candidate.email).slice(0, 4).map((candidate: any) => candidate.email);
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a">${String(step.draft.body).split(/\n+/).map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("")}</div>`;
    const sent = await sendEmail({ workspaceId: api.workspaceId, to: lead.email, bcc: copies, subject: step.draft.subject, text: step.draft.body, html });
    cadence[parsed.data.index] = { ...step, status: "completed", completedAt: new Date().toISOString(), emailId: sent.id };
  } else {
    cadence[parsed.data.index] = { ...step, status: "completed", completedAt: new Date().toISOString(), completedManually: true };
  }
  await prisma.lead.update({ where: { id: lead.id }, data: { rawData: { ...raw, franchiseGrowth: { ...raw.franchiseGrowth, cadence } } } });
  return NextResponse.json({ ok: true, cadence });
});
