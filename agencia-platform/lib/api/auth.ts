import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { touchSession } from "@/lib/security/sessions";

export type ApiContext = {
  workspaceId: string;
  userId?: string;
  apiKeyId?: string;
  scopes: Set<string>;
  /** sid de la sesión NextAuth si la auth vino por cookie. Permite a los
   *  endpoints saber CUÁL es la sesión actual (para distinguirla en la
   *  lista de "sesiones activas") y verificar que sigue viva. */
  sid?: string;
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

  // Authorization: Bearer <jwt-de-NextAuth> — usado por la extensión
  // de Chrome. Como las cookies NextAuth tienen SameSite=Lax, Chrome
  // NO las envía cross-site desde el contexto de extensión a pesar
  // de host_permissions. La extensión las LEE con chrome.cookies.get
  // y las pasa explícitamente en este header. Aquí intentamos
  // decodificar el token como JWT NextAuth si NO empieza por el
  // prefix de API key.
  if (header?.startsWith("Bearer ") && !header.includes(PREFIX)) {
    const rawJwt = header.slice("Bearer ".length).trim();
    if (rawJwt) {
      try {
        const decoded = await getToken({
          req: { headers: { cookie: `next-auth.session-token=${rawJwt}` } } as any,
          secret: process.env.NEXTAUTH_SECRET ?? "",
          // Probamos sin secure primero; si NextAuth está en HTTPS
          // production, el cookieName puede ser __Secure- prefixed.
          // getToken intenta varios; el secret es lo único crítico.
          raw: false
        });
        if (decoded && typeof decoded === "object" && (decoded as any).uid) {
          const tok = decoded as any;
          // Si la JWT trae sid, validamos como en el flow de cookie.
          const sid = tok.sid as string | undefined;
          if (sid) {
            const alive = await touchSession(sid);
            if (!alive) {
              throw new ApiError(401, "session_revoked", "Esta sesión ha sido revocada. Vuelve a iniciar sesión en el Hub.");
            }
          }
          if (!tok.workspaceId) throw new ApiError(403, "no_workspace", "Usuario sin workspace asignado");
          return {
            workspaceId: tok.workspaceId as string,
            userId: tok.uid as string,
            scopes: new Set(["*"]),
            sid
          };
        }
      } catch (e: any) {
        // Si la decodificación falla pero el header parece JWT, lo
        // pasamos abajo (cookie clásica) por si funcionara — no
        // queremos romper si el token llega mal formado.
        if (e instanceof ApiError) throw e;
      }
    }
  }

  // Sesión de NextAuth (vía cookie estándar, web normal)
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const u = session.user as any;
    if (!u.workspaceId) throw new ApiError(403, "no_workspace", "Usuario sin workspace asignado");

    // Si la JWT trae sid (set en el callback signIn → jwt), validamos
    // que la sesión sigue viva. Si fue revocada desde otro dispositivo,
    // la cookie deja de funcionar de inmediato. Si NO trae sid (sesión
    // creada antes de añadir este tracking) no rompemos retro-compat.
    const sid = u.sid as string | undefined;
    if (sid) {
      const alive = await touchSession(sid);
      if (!alive) {
        throw new ApiError(401, "session_revoked", "Esta sesión ha sido revocada. Vuelve a iniciar sesión.");
      }
    }

    return {
      workspaceId: u.workspaceId,
      userId: u.id,
      scopes: new Set(["*"]), // sesión humana = scope total
      sid
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
