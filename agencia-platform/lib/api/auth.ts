import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type ApiContext = {
  workspaceId: string;
  userId?: string;
  apiKeyId?: string;
  scopes: Set<string>;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const PREFIX = process.env.API_KEY_PREFIX ?? "ag_";

export async function authenticate(req: NextRequest): Promise<ApiContext> {
  const header = req.headers.get("authorization");

  // API key (Authorization: Bearer ag_xxx.yyy)
  if (header?.startsWith("Bearer ") && header.includes(PREFIX)) {
    const token = header.slice("Bearer ".length).trim();
    const [prefix, secret] = token.split(".");
    if (!prefix || !secret) throw new ApiError(401, "invalid_api_key", "API key con formato inválido");

    const apiKey = await prisma.apiKey.findUnique({ where: { prefix } });
    if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt < new Date())) {
      throw new ApiError(401, "invalid_api_key", "API key inválida o caducada");
    }
    const ok = await bcrypt.compare(secret, apiKey.hashed);
    if (!ok) throw new ApiError(401, "invalid_api_key", "API key inválida");

    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return {
      workspaceId: apiKey.workspaceId,
      userId: apiKey.userId ?? undefined,
      apiKeyId: apiKey.id,
      scopes: new Set(apiKey.scopes)
    };
  }

  // Sesión de NextAuth
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const u = session.user as any;
    if (!u.workspaceId) throw new ApiError(403, "no_workspace", "Usuario sin workspace asignado");
    return {
      workspaceId: u.workspaceId,
      userId: u.id,
      scopes: new Set(["*"]) // sesión humana = scope total
    };
  }

  throw new ApiError(401, "unauthenticated", "Falta API key o sesión válida");
}

export function requireScope(ctx: ApiContext, scope: string) {
  if (ctx.scopes.has("*") || ctx.scopes.has(scope)) return;
  throw new ApiError(403, "scope_required", `Necesita scope: ${scope}`);
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error("API error", err);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Error interno" } },
    { status: 500 }
  );
}
