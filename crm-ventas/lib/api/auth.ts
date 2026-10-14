import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, resolveSessionMember } from "@/lib/auth";

// Contexto de las rutas de los módulos de contenidos (portados del Hub). En
// el CRM solo hay sesiones humanas: scope total dentro de su workspace.
export type ApiContext = {
  workspaceId: string;
  userId?: string;
  role?: string;
  apiKeyId?: string;
  scopes: Set<string>;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function authenticate(_req?: NextRequest): Promise<ApiContext> {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.workspaceId || !(session?.user as any)?.id) {
    throw new ApiError(401, "unauthenticated", "Inicia sesión para continuar");
  }
  // Revalida en BD: usuario aún existe en ese workspace y el workspace no está
  // bloqueado (o es un operador de Negocio Vivo dentro del cliente).
  const member = await resolveSessionMember(session);
  if (!member) throw new ApiError(401, "unauthenticated", "Tu sesión ya no es válida. Vuelve a entrar.");
  return { workspaceId: member.workspaceId, userId: member.userId, role: member.role, scopes: new Set(["*"]) };
}

export function requireScope(ctx: ApiContext, scope: string) {
  if (ctx.scopes.has("*") || ctx.scopes.has(scope)) return;
  throw new ApiError(403, "scope_required", `Necesita scope: ${scope}`);
}

export function requireAdminRole(ctx: ApiContext) {
  if (ctx.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo los administradores del negocio pueden hacer esto");
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status }
    );
  }
  console.error("API error", err);
  return NextResponse.json({ error: { code: "internal_error", message: "Error interno" } }, { status: 500 });
}
