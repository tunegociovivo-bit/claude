/**
 * GET /api/v1/gmb/google/sources — cuentas de Google conectadas para vincular fichas:
 *  - OAuth propio del Hub (GmbGoogleConnection): directo, si Google ha aprobado el proyecto.
 *  - Conexiones «Google Business Profile» de Make: funcionan siempre (app de Google aprobada).
 * Indica además si el acceso directo del proyecto del Hub está aprobado. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { gbpOAuthConfigurationIssue } from "@/lib/gmb/gbp-oauth";
import { gmbDirectAccess } from "@/lib/integrations/gmb";
import { makeListConnections } from "@/lib/integrations/make";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type GoogleSource = { source: string; kind: "hub" | "make"; email: string; label: string; linked: number; revoked?: boolean };

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = api.workspaceId;
  const [hubRows, makeConns, clients] = await Promise.all([
    prisma.gmbGoogleConnection.findMany({ where: { workspaceId: ws }, orderBy: { updatedAt: "desc" } }),
    makeListConnections(ws, ["google-my-business2"]).catch(() => null),
    prisma.gmbClient.findMany({ where: { workspaceId: ws }, select: { connectionId: true, googleConnectionId: true } })
  ]);
  const direct = hubRows.some((r) => !r.revokedAt) ? await gmbDirectAccess(ws) : { ok: false, error: "Sin cuentas conectadas con el OAuth del Hub" };
  const count = (pred: (c: { connectionId: string; googleConnectionId: string }) => boolean) => clients.filter(pred).length;

  const sources: GoogleSource[] = [];
  if (direct.ok) {
    for (const r of hubRows)
      sources.push({ source: `hub:${r.id}`, kind: "hub", email: r.email, label: r.email, linked: count((c) => c.googleConnectionId === r.id), revoked: !!r.revokedAt });
  }
  for (const c of makeConns ?? []) {
    // Si la misma cuenta ya está con OAuth directo operativo, no se duplica.
    if (direct.ok && sources.some((s) => s.kind === "hub" && s.email.toLowerCase() === c.email.toLowerCase())) continue;
    sources.push({ source: `make:${c.id}`, kind: "make", email: c.email, label: c.email || c.name, linked: count((x) => x.connectionId === String(c.id)) });
  }
  // Varias conexiones de Make de la misma cuenta → se deja la que tiene más fichas (o la más reciente).
  const seen = new Map<string, GoogleSource>();
  for (const s of sources) {
    const k = `${s.kind}:${s.email.toLowerCase() || s.source}`;
    const prev = seen.get(k);
    if (!prev || s.linked > prev.linked) seen.set(k, s);
  }

  return NextResponse.json({
    ok: true,
    sources: [...seen.values()],
    direct: { configured: gbpOAuthConfigurationIssue() === null, approved: direct.ok, error: direct.ok ? null : direct.error ?? null },
    make: { available: makeConns !== null }
  });
});
