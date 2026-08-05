import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
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
export async function requireWorkspaceId(): Promise<string> {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  if (!workspaceId) throw new Error("UNAUTHORIZED");
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
    where: { id: userId, workspaceId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return { workspaceId, userId };
}

export function unauthorized() {
  return Response.json({ error: "No autorizado" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "Solo un administrador puede realizar esta acción" }, { status: 403 });
}
