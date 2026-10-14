import { NextRequest } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxAdmin, requireInboxUser } from "@/lib/inbox/api";
import { ensureIntakeToken, getLeadsState, saveLeadsConfig } from "@/lib/leads/settings";
import { forwardTargetErrors, MAX_FORWARD_TARGETS, MAX_LEAD_STATUSES } from "@/lib/leads/config";
import { getWorkspaceSettings, publicBaseUrl } from "@/lib/settings";

export const dynamic = "force-dynamic";

function intakeUrl(token: string) {
  return token ? `${publicBaseUrl()}/api/webhooks/leads/${token}` : "";
}

// GET → configuración del módulo «Leads y reenvíos». La URL de entrada de Make
// (lleva el token secreto) solo se muestra a los administradores.
export async function GET() {
  try {
    const user = await requireInboxUser();
    const state = await getLeadsState(user.workspaceId);
    if (!state.enabled) return Response.json({ enabled: false });
    return Response.json({
      enabled: true,
      statuses: state.statuses,
      forwardTargets: state.forwardTargets,
      intakeUrl: user.isAdmin ? intakeUrl(state.intakeToken || (await ensureIntakeToken(user.workspaceId))) : undefined,
      isAdmin: user.isAdmin,
    });
  } catch (error) {
    return inboxError(error);
  }
}

const putSchema = z.object({
  statuses: z
    .array(z.object({ id: z.string().max(60).optional(), label: z.string().max(60), color: z.string().max(20).optional() }))
    .max(MAX_LEAD_STATUSES)
    .optional(),
  forwardTargets: z
    .array(z.object({ id: z.string().max(60).optional(), label: z.string().max(60), phone: z.string().max(40) }))
    .max(MAX_FORWARD_TARGETS)
    .optional(),
  regenerateToken: z.literal(true).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const state = await getLeadsState(user.workspaceId);
    if (!state.enabled) return Response.json({ error: "El módulo de leads no está activo en tu cuenta" }, { status: 403 });
    const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    const { statuses, forwardTargets, regenerateToken } = parsed.data;
    if (forwardTargets) {
      const settings = await getWorkspaceSettings(user.workspaceId);
      const errors = forwardTargetErrors(forwardTargets, settings.whatsapp.countryCode || "34");
      if (errors.length) return Response.json({ error: errors.join(" ") }, { status: 400 });
    }
    if (statuses && statuses.filter((s) => s.label.trim()).length === 0) {
      return Response.json({ error: "Deja al menos un estado" }, { status: 400 });
    }
    const saved = await saveLeadsConfig(user.workspaceId, { statuses: statuses as any, forwardTargets: forwardTargets as any, regenerateToken });
    return Response.json({
      ok: true,
      enabled: true,
      statuses: saved.statuses,
      forwardTargets: saved.forwardTargets,
      intakeUrl: intakeUrl(saved.intakeToken),
      isAdmin: true,
    });
  } catch (error) {
    return inboxError(error);
  }
}
