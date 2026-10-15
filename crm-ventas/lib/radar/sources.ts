import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import { PORTALS, isPortalKey } from "./portals";

export type SourceView = {
  portal: string;
  name: string;
  loginHost: string;
  enabled: boolean;
  hasCredentials: boolean;
  username: string | null; // solo el usuario (para que el cliente lo reconozca); nunca la contraseña
  status: string;
  statusDetail: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastCount: number | null;
  notes?: string;
};

const STATUS_WITHOUT_CREDS = "pending";

export async function listSources(workspaceId: string): Promise<SourceView[]> {
  const rows = await prisma.radarSource.findMany({ where: { workspaceId } });
  const byPortal = new Map(rows.map((r) => [r.portal, r] as const));
  return PORTALS.map((p) => {
    const row = byPortal.get(p.key);
    let host = "";
    try {
      host = new URL(p.loginUrl).host;
    } catch {
      host = p.loginUrl;
    }
    return {
      portal: p.key,
      name: p.name,
      loginHost: host,
      enabled: row?.enabled ?? false,
      hasCredentials: Boolean(row?.usernameEnc && row?.passwordEnc),
      username: row?.usernameEnc ? decryptUsername(row.usernameEnc) : null,
      status: row?.status ?? STATUS_WITHOUT_CREDS,
      statusDetail: row?.statusDetail ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastOkAt: row?.lastOkAt?.toISOString() ?? null,
      lastCount: row?.lastCount ?? null,
      notes: p.notes,
    };
  });
}

function decryptUsername(enc: string): string | null {
  return decryptSecret(enc);
}

/** Guarda (o actualiza) las credenciales de un portal. La contraseña vacía conserva la anterior. */
export async function saveSourceCredentials(opts: {
  workspaceId: string;
  portal: string;
  username: string;
  password: string | null;
  enabled?: boolean;
}): Promise<void> {
  if (!isPortalKey(opts.portal)) throw new Error("Portal desconocido");
  const username = opts.username.trim();
  if (!username) throw new Error("Pon el usuario del portal");
  const existing = await prisma.radarSource.findUnique({
    where: { workspaceId_portal: { workspaceId: opts.workspaceId, portal: opts.portal } },
    select: { id: true, passwordEnc: true },
  });
  const passwordEnc = opts.password && opts.password.length > 0 ? encryptSecret(opts.password) : existing?.passwordEnc ?? null;
  if (!passwordEnc) throw new Error("Pon la contraseña del portal");

  await prisma.radarSource.upsert({
    where: { workspaceId_portal: { workspaceId: opts.workspaceId, portal: opts.portal } },
    update: {
      usernameEnc: encryptSecret(username),
      passwordEnc,
      ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
      // Credenciales nuevas: se borra la sesión guardada y se reinicia el estado.
      sessionEnc: null,
      sessionSavedAt: null,
      status: "pending",
      statusDetail: null,
      consecutiveFailures: 0,
    },
    create: {
      workspaceId: opts.workspaceId,
      portal: opts.portal,
      usernameEnc: encryptSecret(username),
      passwordEnc,
      enabled: opts.enabled ?? true,
      status: "pending",
    },
  });
}

export async function setSourceEnabled(workspaceId: string, portal: string, enabled: boolean): Promise<void> {
  if (!isPortalKey(portal)) throw new Error("Portal desconocido");
  await prisma.radarSource.update({
    where: { workspaceId_portal: { workspaceId, portal } },
    data: { enabled },
  });
}

export async function deleteSource(workspaceId: string, portal: string): Promise<void> {
  await prisma.radarSource.deleteMany({ where: { workspaceId, portal } });
}

export async function getSourceId(workspaceId: string, portal: string): Promise<string | null> {
  const row = await prisma.radarSource.findUnique({
    where: { workspaceId_portal: { workspaceId, portal } },
    select: { id: true },
  });
  return row?.id ?? null;
}
