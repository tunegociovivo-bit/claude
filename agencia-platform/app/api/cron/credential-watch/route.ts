/**
 * Cron de monitoreo proactivo de credenciales.
 *
 * Cada 6h (o lo que decida el caller) recorre todos los workspaces,
 * valida las integraciones configuradas, y alerta al admin del
 * workspace por multi-canal (Telegram/WhatsApp) si alguna falla.
 *
 * Dedupe: solo alerta UNA VEZ por integración hasta que el problema
 * se resuelva. El estado se guarda en
 *   Workspace.settings.credentialWatch.lastAlerted[integrationName] = ISO
 *
 * Cuando la siguiente validación reporta OK, limpiamos esa marca —
 * así si vuelve a romperse en el futuro, alerta de nuevo.
 *
 * Seguridad: header Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  validateWorkspaceCredentials,
  type IntegrationName,
  type CredentialCheck
} from "@/lib/credentials/validate";
import { notifyHumanOutsideHub } from "@/lib/notifications/multi-channel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }

  // Procesamos todos los workspaces que tienen aiAgent configurado
  // (los que NO usan Sonia no necesitan vigilancia de credentials).
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, settings: true }
  });

  const summary: Array<{
    workspaceId: string;
    workspaceName: string;
    valid: number;
    invalid: number;
    newAlerts: string[];
    resolved: string[];
  }> = [];

  for (const ws of workspaces) {
    const s = (ws.settings as any) ?? {};
    // Skip si el workspace no usa Sonia
    if (!s.aiAgent?.userId) continue;

    const result = await validateWorkspaceCredentials({ workspaceId: ws.id });
    if (result.checked.length === 0) continue;

    const watchState = (s.credentialWatch?.lastAlerted ?? {}) as Record<string, string>;
    const newAlerts: string[] = [];
    const resolved: string[] = [];

    // Detectar problemas NUEVOS (no alertados) y RESUELTOS (alertados pero ahora OK)
    for (const inv of result.invalid) {
      const key = inv.integration;
      const reason = inv.ok ? "" : inv.reason;
      if (!watchState[key]) {
        newAlerts.push(`${key}: ${reason}`);
        watchState[key] = new Date().toISOString();
      }
    }
    for (const v of result.valid) {
      const key = v.integration;
      if (watchState[key]) {
        resolved.push(key);
        delete watchState[key];
      }
    }

    // Persistir el estado actualizado
    if (newAlerts.length > 0 || resolved.length > 0) {
      const newSettings = { ...s, credentialWatch: { lastAlerted: watchState } };
      await prisma.workspace.update({
        where: { id: ws.id },
        data: { settings: newSettings }
      });
    }

    // Alertar via multi-canal SOLO en nuevos fallos. Los resueltos se
    // notifican como "info" más ligero (opcional).
    if (newAlerts.length > 0) {
      const adminUserId = s.aiAgent?.notificationChannels
        ? Object.keys(s.aiAgent.notificationChannels)[0]
        : null;
      if (adminUserId) {
        await notifyHumanOutsideHub({
          workspaceId: ws.id,
          userId: adminUserId,
          level: "critical",
          title: `Credenciales caducadas — ${ws.name}`,
          body:
            `Detectado al monitorizar:\n\n` +
            newAlerts.map((a) => `• ${a}`).join("\n") +
            `\n\nRevísalo antes de que una task lo necesite. Sonia ya no podrá usar estas integraciones hasta resolver.`,
          linkPath: "/admin/credentials"
        }).catch((e) => console.warn("[cred-watch] notify error:", e?.message));
      }
    }

    summary.push({
      workspaceId: ws.id,
      workspaceName: ws.name,
      valid: result.valid.length,
      invalid: result.invalid.length,
      newAlerts,
      resolved
    });
  }

  return NextResponse.json({ ok: true, processedWorkspaces: summary.length, summary });
}
