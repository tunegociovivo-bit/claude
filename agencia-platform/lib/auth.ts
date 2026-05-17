import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import {
  checkLoginAllowed,
  ipFromHeaders,
  recordLoginAttempt
} from "@/lib/security/login-throttle";
import { hasTotp, verifyCode } from "@/lib/security/totp";
import { createSession } from "@/lib/security/sessions";

// Mensajes lanzados como Error(message) — NextAuth los devuelve al
// frontend en la query `?error=`. La UI los traduce a mensajes
// amigables.
const ERR_LOCKED = "AccountLocked";
const ERR_TOTP_REQUIRED = "TotpRequired";
const ERR_TOTP_BAD = "TotpInvalid";
const ERR_BAD_CREDS = "CredentialsSignin"; // estándar de NextAuth

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        // El form de login añade este campo dinámicamente en el paso 2
        // cuando el back responde TotpRequired. En el paso 1 viene vacío.
        totpCode: { label: "Código 2FA", type: "text" }
      },
      // NextAuth pasa el `req` nativo de Node como segundo arg, de
      // donde sacamos IP + UA para throttling/audit.
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase() ?? "";
        const password = credentials?.password ?? "";
        const totpCode = credentials?.totpCode?.trim() ?? "";
        const ip = ipFromHeaders(req?.headers as any);
        const userAgent =
          ((req?.headers as any)?.["user-agent"] as string | undefined) ?? null;

        if (!email || !password) {
          await recordLoginAttempt({ email: email || "unknown", ip, userAgent, success: false, reason: "missing_fields" });
          return null;
        }

        // Throttle check ANTES de tocar BD/hash — cortocircuita ataques.
        const throttle = await checkLoginAllowed(email, ip);
        if (!throttle.allowed) {
          await recordLoginAttempt({ email, ip, userAgent, success: false, reason: throttle.reason });
          throw new Error(`${ERR_LOCKED}:${throttle.retryAfterSec}`);
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "no_user" });
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "bad_password" });
          return null;
        }

        // Si el user tiene 2FA, exigimos el segundo factor.
        if (await hasTotp(user.id)) {
          if (!totpCode) {
            // Señal al front: "vuelve a llamar con totpCode". No
            // contamos como intento fallido — el password fue OK.
            throw new Error(ERR_TOTP_REQUIRED);
          }
          const v = await verifyCode(user.id, totpCode);
          if (!v.ok) {
            await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "bad_totp" });
            throw new Error(ERR_TOTP_BAD);
          }
        }

        await recordLoginAttempt({ email, ip, userAgent, success: true });

        // Creamos una fila UserSession con sid único — viajará en la
        // JWT como `sid` y permite listar/revocar la sesión luego.
        const sid = await createSession({ userId: user.id, ip, userAgent });

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          // Atributo no-estándar; lo recogemos en jwt() callback.
          sid
        } as any;
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
        // sid solo se setea en login (cuando hay `user`), no en
        // refreshes posteriores — así sobrevive en la JWT.
        const sid = (user as any).sid as string | undefined;
        if (sid) token.sid = sid;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).workspaceId = token.workspaceId;
        (session.user as any).role = token.role;
        (session.user as any).sid = token.sid;
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
