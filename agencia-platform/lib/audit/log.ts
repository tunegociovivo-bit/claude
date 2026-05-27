/**
 * Helper para escribir entradas en AuditLog. Diseñado para ser
 * best-effort: si la inserción falla nunca rompe la request — los
 * errores se loggean y ya está. La firma es deliberadamente simple
 * para que llamarlo desde un endpoint sea una línea.
 *
 * El modelo AuditLog ya existía con campos targetType/targetId/meta;
 * los detalles ricos (before/after, IP, userAgent, apiKeyId) los
 * guardamos dentro de `meta` (Json) para no tener que migrar.
 *
 * Convenciones de `action`:
 *   - "client.update", "client.delete", "client.mrr_change"
 *   - "task.create", "task.delete"
 *   - "user.role_change", "user.features_change"
 *   - "apikey.create", "apikey.revoke"
 *   - "auth.login", "auth.failed_login"
 *   - "credential.read" (lectura de secretos compartidos)
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ApiContext } from "@/lib/api/auth";

export type AuditInput = {
  workspaceId: string;
  actorId?: string | null;
  apiKeyId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: any;
  after?: any;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, any>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? undefined,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: {
          apiKeyId: input.apiKeyId ?? undefined,
          before: input.before,
          after: input.after,
          ip: input.ip ?? undefined,
          userAgent: input.userAgent ?? undefined,
          ...(input.meta ?? {})
        } as any
      }
    });
  } catch (e: any) {
    console.warn("[audit] no se pudo registrar:", e?.message ?? e);
  }
}

/** Atajo para sacar IP + UA + apiKey + actor desde un withApi handler. */
export function auditFromReq(
  req: NextRequest,
  api: ApiContext,
  rest: Omit<AuditInput, "workspaceId" | "actorId" | "apiKeyId" | "ip" | "userAgent">
): Promise<void> {
  return recordAudit({
    workspaceId: api.workspaceId,
    actorId: api.userId,
    apiKeyId: api.apiKeyId,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
    ...rest
  });
}
