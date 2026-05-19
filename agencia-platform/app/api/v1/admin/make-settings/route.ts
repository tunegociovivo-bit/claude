/**
 * GET    /api/v1/admin/make-settings  → estado actual de la integración
 * PUT    /api/v1/admin/make-settings  → guarda apiToken + zone + teamId
 * DELETE /api/v1/admin/make-settings  → desactiva (borra config)
 *
 * El PUT valida contra Make antes de persistir: GET /teams con el token
 * para verificar que funciona y traer la lista de teams. Si el user no
 * eligió teamId, sugerimos el primero.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { encryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

const ZONES = ["eu1", "eu2", "us1", "us2"] as const;
type Zone = (typeof ZONES)[number];

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const cfg = (ws?.settings as any)?.integrations?.make ?? {};
  return NextResponse.json({
    hasToken: !!cfg.apiTokenEnc,
    zone: cfg.zone ?? "eu1",
    teamId: cfg.teamId ?? null
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const apiToken = typeof body?.apiToken === "string" ? body.apiToken.trim() : "";
  const zone = (
    typeof body?.zone === "string" && (ZONES as readonly string[]).includes(body.zone)
      ? body.zone
      : "eu1"
  ) as Zone;
  const teamId = typeof body?.teamId === "number" ? body.teamId : null;

  // Si llega vacío y no hay actual, error. Si llega vacío y hay actual,
  // solo tocamos zone/teamId (mantenemos token).
  const ws0 = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const existing = (ws0?.settings as any)?.integrations?.make;
  if (!apiToken && !existing?.apiTokenEnc) {
    return NextResponse.json(
      { error: "apiToken requerido la primera vez." },
      { status: 400 }
    );
  }

  // Token a usar para validar (nuevo si llegó, descifrado si no)
  let plainToken = apiToken;
  if (!plainToken && existing?.apiTokenEnc) {
    const { decryptSecret } = await import("@/lib/ai/crypto");
    plainToken = decryptSecret(existing.apiTokenEnc) ?? "";
  }

  // Validar contra Make: GET /teams
  const r = await fetch(`https://${zone}.make.com/api/v2/teams`, {
    headers: {
      Authorization: `Token ${plainToken}`,
      "Content-Type": "application/json"
    }
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json(
      {
        error:
          r.status === 401
            ? "Token inválido (Make respondió 401). Verifica que tiene scopes scenarios:read+write, teams:read, connections:read."
            : r.status === 403
              ? "Token sin permisos suficientes. Recrea con scopes scenarios:read+write, teams:read."
              : `Make ${r.status}: ${t.slice(0, 200)}`
      },
      { status: 400 }
    );
  }
  const teamData = await r.json();
  const teams = (teamData.teams ?? []).map((t: any) => ({
    id: t.id,
    name: t.name
  }));
  // Si el user no eligió teamId pero hay solo 1, lo seteamos automático
  const effectiveTeamId =
    teamId ?? (teams.length === 1 ? teams[0].id : null);

  const settings: any = ws0?.settings ?? {};
  if (!settings.integrations) settings.integrations = {};
  settings.integrations.make = {
    apiTokenEnc: apiToken ? encryptSecret(apiToken) : existing!.apiTokenEnc,
    zone,
    teamId: effectiveTeamId
  };
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({
    ok: true,
    zone,
    teamId: effectiveTeamId,
    teamsAvailable: teams
  });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (settings?.integrations?.make) {
    delete settings.integrations.make;
    await prisma.workspace.update({
      where: { id: api.workspaceId },
      data: { settings }
    });
  }
  return NextResponse.json({ ok: true });
});
