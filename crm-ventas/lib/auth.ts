import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export function isOperatorEmail(email: string | null | undefined) {
  if (!email) return false;
  return (process.env.NV_OPERATOR_EMAILS || "")
    .split(",")
    .map((value) => value.toLowerCase().trim())
    .filter(Boolean)
    .includes(email.toLowerCase().trim());
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email }, include: { workspace: true } });
        if (!user || (user.workspace.isBlocked && !isOperatorEmail(user.email))) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          workspaceId: user.workspaceId,
          role: user.role,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = (user as any).id;
        token.workspaceId = (user as any).workspaceId;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as any).id = token.uid;
      (session.user as any).workspaceId = token.workspaceId;
      (session.user as any).role = token.role;
      return session;
    },
  },
};

// Devuelve el workspaceId de la sesión actual o lanza 401 (vía throw).
// Revalida contra BD que el usuario sigue existiendo en ese workspace: un JWT
// de un usuario eliminado deja de servir en la siguiente petición.
export async function requireWorkspaceId(): Promise<string> {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!workspaceId || !userId) throw new Error("UNAUTHORIZED");
  const exists = await prisma.user.findFirst({
    where: { id: userId, workspaceId, workspace: { isBlocked: false } },
    select: { id: true },
  });
  if (!exists) throw new Error("UNAUTHORIZED");
  return workspaceId;
}

export async function requireWorkspaceAdmin(): Promise<{
  workspaceId: string;
  userId: string;
}> {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  const userId = (session?.user as any)?.id as string | undefined;
  if (!workspaceId || !userId) throw new Error("UNAUTHORIZED");

  // Revalidamos el rol en BD para que una sesión antigua no conserve permisos.
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, workspace: { isBlocked: false } },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return { workspaceId, userId };
}

// Operador de Negocio Vivo (rol global, distinto del ADMIN de workspace).
// Fail-closed: si NV_OPERATOR_EMAILS está vacío o sin definir, NADIE es
// operador. Se revalida contra BD que el usuario sigue existiendo.
export async function requireOperator(): Promise<{ userId: string; email: string }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase().trim();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!email || !userId) throw new Error("UNAUTHORIZED");
  if (!isOperatorEmail(email)) throw new Error("FORBIDDEN");
  const user = await prisma.user.findFirst({ where: { id: userId, email }, select: { id: true } });
  if (!user) throw new Error("UNAUTHORIZED");
  return { userId, email };
}

export function unauthorized() {
  return Response.json({ error: "No autorizado" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "Solo un administrador puede realizar esta acción" }, { status: 403 });
}

// Las mutaciones de la API solo se aceptan desde el propio frontend. Si el
// navegador manda Origin, debe coincidir con el host de la petición o con la
// URL pública configurada (detrás del proxy de Railway pueden diferir).
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const allowed = new Set([new URL(request.url).origin]);
    const publicUrl = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
    if (publicUrl) allowed.add(new URL(publicUrl).origin);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}
