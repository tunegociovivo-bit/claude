import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
      }
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
          })
        ]
      : [])
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { joinedAt: "asc" }
        });
        token.uid = user.id;
        token.workspaceId = membership?.workspaceId;
        token.role = membership?.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).workspaceId = token.workspaceId;
        (session.user as any).role = token.role;
      }
      return session;
    }
  }
};

export async function getSessionWorkspaceId(): Promise<string | null> {
  const { getServerSession } = await import("next-auth");
  const s = await getServerSession(authOptions);
  return (s?.user as any)?.workspaceId ?? null;
}
