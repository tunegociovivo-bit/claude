import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import type { SessionToken } from "@/lib/admin/acting-core";

const SECURE_COOKIE = "__Secure-next-auth.session-token";
const PLAIN_COOKIE = "next-auth.session-token";
// Mismos valores que usa NextAuth (por defecto, 30 días).
const SESSION_MAX_AGE = authOptions.session?.maxAge ?? 30 * 24 * 60 * 60;

function sessionSecret(): string | undefined {
  return authOptions.secret ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
}

// La misma cookie que lee NextAuth: segura si NEXTAUTH_URL es https (su regla).
// Sin NEXTAUTH_URL, la que ya trae la petición.
function sessionCookieName(req: NextRequest): string {
  if (typeof authOptions.useSecureCookies === "boolean") return authOptions.useSecureCookies ? SECURE_COOKIE : PLAIN_COOKIE;
  const base = process.env.NEXTAUTH_URL;
  if (base) return base.startsWith("https://") ? SECURE_COOKIE : PLAIN_COOKIE;
  return req.cookies.has(SECURE_COOKIE) ? SECURE_COOKIE : PLAIN_COOKIE;
}

export async function readSessionToken(req: NextRequest): Promise<SessionToken | null> {
  const cookieName = sessionCookieName(req);
  const token = await getToken({
    req,
    secret: sessionSecret(),
    cookieName,
    secureCookie: cookieName === SECURE_COOKIE,
  });
  return (token as SessionToken | null) ?? null;
}

export async function writeSessionToken(req: NextRequest, res: NextResponse, token: SessionToken) {
  const secret = sessionSecret();
  if (!secret) throw new Error("NEXTAUTH_SECRET no configurado");
  const cookieName = sessionCookieName(req);
  // iat/exp/jti los vuelve a poner encode(); no se arrastran los antiguos.
  const { iat: _iat, exp: _exp, jti: _jti, ...claims } = token;
  const value = await encode({ token: claims as any, secret, maxAge: SESSION_MAX_AGE });
  res.cookies.set(cookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieName === SECURE_COOKIE,
    maxAge: SESSION_MAX_AGE,
  });
}
