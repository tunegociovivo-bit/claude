/**
 * POST /api/v1/leads/proxy-test
 *
 * Verifica un proxy en el momento (botón "Probar"). Body:
 *   { proxy?: string }   → prueba esa cadena tal cual (sin guardarla)
 *   { channel?: string } → prueba el proxy de ese canal (o el global si no tiene)
 *   (sin body)           → prueba el proxy global
 * Devuelve { ok, exitIp, ms, error } y persiste el estado en proxyStatus.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { checkProxy } from "@/lib/leads/proxy";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => ({} as any));

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const leads: any = (ws?.settings as any)?.leads ?? {};

  let proxy: string | null = null;
  let key = "__global__";
  if (typeof body?.proxy === "string" && body.proxy.trim()) {
    proxy = body.proxy.trim();
    key = typeof body?.channel === "string" && body.channel ? body.channel : "__global__";
  } else if (typeof body?.channel === "string" && body.channel) {
    const c = (Array.isArray(leads.channels) ? leads.channels : []).find((x: any) => x?.name === body.channel);
    proxy = (c?.proxy && String(c.proxy).trim()) || (leads.wahaProxy && String(leads.wahaProxy).trim()) || null;
    key = body.channel;
  } else {
    proxy = (leads.wahaProxy && String(leads.wahaProxy).trim()) || null;
    key = "__global__";
  }

  if (!proxy) {
    return NextResponse.json({ ok: false, error: "No hay proxy configurado para probar." }, { status: 400 });
  }

  const r = await checkProxy(proxy);

  // Persistir el estado para que el badge/aviso lo reflejen.
  const settings: any = ws?.settings ?? {};
  settings.leads = settings.leads ?? {};
  settings.leads.proxyStatus = settings.leads.proxyStatus ?? {};
  settings.leads.proxyStatus[key] = { ...r, checkedAt: new Date().toISOString(), justFailed: false };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } }).catch(() => {});

  return NextResponse.json(r);
});
