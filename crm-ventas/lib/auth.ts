import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export function isOperatorEmail(email: string | null | undefined) {
  if (!email) return false;
  const normalizedEmail = email.toLowerCase().trim();
  const configured = (process.env.NV_OPERATOR_EMAILS || "")
    .split(",")
    .map((value) => value.toLowerCase().trim())
    .filter(Boolean);
  const owners = new Set([
    "admin@crm.local",
    "tunegociovivo@gmail.com",
    "info@negociovivo.com",
    ...configured,
  ]);
  return normalizedEmail.endsWith("@negociovivo.com") || owners.has(normalizedEmail);
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
      // Operador de Negocio Vivo dentro del CRM de un cliente (ver lib/admin/acting-core.ts).
      (session.user as any).operatorActing = token.operatorActing === true;
      return session;
    },
  },
};

export type SessionMember = {
  workspaceId: string;
  userId: string;
  role: string;
  email: string;
  operatorActing: boolean;
};

// Miembro del workspace de la sesión, revalidado en BD en cada petición (un JWT
// de un usuario eliminado o de un workspace bloqueado deja de servir).
// Modo operador: el usuario es de Negocio Vivo y no pertenece al workspace del
// cliente; se acepta solo si su email sigue siendo de operador y el workspace
// existe. Entra como ADMIN, también en clientes bloqueados (soporte).
export async function resolveSessionMember(session?: unknown): Promise<SessionMember | null> {
  const current = (session === undefined ? await getServerSession(authOptions) : session) as any;
  const workspaceId = current?.user?.workspaceId as string | undefined;
  const userId = current?.user?.id as string | undefined;
  if (!workspaceId || !userId) return null;
  if (current?.user?.operatorActing === true) {
    const [operator, workspace] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }),
    ]);
    if (!operator || !workspace || !isOperatorEmail(operator.email)) return null;
    return { workspaceId, userId, role: "ADMIN", email: operator.email, operatorActing: true };
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, workspace: { isBlocked: false } },
    select: { role: true, email: true },
  });
  if (!user) return null;
  return { workspaceId, userId, role: user.role, email: user.email, operatorActing: false };
}

// Devuelve el workspaceId de la sesión actual o lanza 401 (vía throw).
export async function requireWorkspaceId(): Promise<string> {
  const member = await resolveSessionMember();
  if (!member) throw new Error("UNAUTHORIZED");
  return member.workspaceId;
}

export async function requireWorkspaceAdmin(): Promise<{
  workspaceId: string;
  userId: string;
}> {
  // El rol se revalida en BD para que una sesión antigua no conserve permisos.
  const member = await resolveSessionMember();
  if (!member) throw new Error("UNAUTHORIZED");
  if (member.role !== "ADMIN") throw new Error("FORBIDDEN");
  return { workspaceId: member.workspaceId, userId: member.userId };
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
