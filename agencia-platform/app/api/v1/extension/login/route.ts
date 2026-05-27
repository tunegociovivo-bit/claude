/**
 * POST /api/v1/extension/login
 * Body: { email, password, totpCode? }
 *
 * Login específico para la extensión de Chrome. NO usa cookies (la
 * extensión no puede mantener sesión NextAuth desde otro origen);
 * en su lugar crea (o renueva) una API key "extension" para ese
 * user con scope `*` y la devuelve. La extensión la guarda en
 * chrome.storage.local y la usa como Bearer en todas las llamadas
 * posteriores (upload-recording, notifications, etc.).
 *
 * Reglas:
 *   - Mismas defensas que CredentialsProvider: throttling por IP/email,
 *     2FA si está activado, registro de intentos.
 *   - El email se normaliza a minúsculas + trim.
 *   - Si el user ya tiene una key "extension-<email>" vigente, la
 *     REVOCAMOS y creamos una nueva (un dispositivo nuevo => key
 *     nueva). Más simple que mantener N keys por device.
 *   - Auditamos la creación.
 *
 * Respuesta éxito:
 *   { token, user: {id, name, email}, workspace: {id, name},
 *     hasTotp: bool }
 *
 * Errores:
 *   401 invalid_credentials, totp_required, totp_invalid, account_locked
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";
import { recordLoginAttempt, checkLoginAllowed, ipFromHeaders } from "@/lib/security/login-throttle";
import { hasTotp, verifyCode } from "@/lib/security/totp";
import { recordAudit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PREFIX = process.env.API_KEY_PREFIX ?? "ag_";

const bodySchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  deviceLabel: z.string().optional() // p.ej. "Chrome en Mac"
});

export async function POST(req: NextRequest) {
  // Rate-limit por IP — login es endpoint público sensible.
  const rl = rateLimitPublic(req, { tag: "extension-login", limit: 20 });
  if (rl) return rl;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Email y contraseña obligatorios" } },
      { status: 400 }
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const ip = ipFromHeaders(req.headers);
  const userAgent = req.headers.get("user-agent");
  const deviceLabel = parsed.data.deviceLabel?.slice(0, 80) ?? "Extensión Chrome";

  // 1) Throttle
  const throttle = await checkLoginAllowed(email, ip);
  if (!throttle.allowed) {
    await recordLoginAttempt({ email, ip, userAgent, success: false, reason: throttle.reason });
    return NextResponse.json(
      {
        error: {
          code: "account_locked",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(throttle.retryAfterSec / 60)} min.`
        }
      },
      { status: 429 }
    );
  }

  // 2) Validar password
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "no_user" });
    return NextResponse.json(
      { error: { code: "invalid_credentials", message: "Email o contraseña incorrectos" } },
      { status: 401 }
    );
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "bad_password" });
    return NextResponse.json(
      { error: { code: "invalid_credentials", message: "Email o contraseña incorrectos" } },
      { status: 401 }
    );
  }

  // 3) 2FA si está activo
  const userHasTotp = await hasTotp(user.id);
  if (userHasTotp) {
    if (!parsed.data.totpCode) {
      return NextResponse.json(
        {
          error: {
            code: "totp_required",
            message: "Introduce el código de 6 dígitos de tu authenticator."
          }
        },
        { status: 401 }
      );
    }
    const v = await verifyCode(user.id, parsed.data.totpCode);
    if (!v.ok) {
      await recordLoginAttempt({ email, ip, userAgent, success: false, reason: "bad_totp" });
      return NextResponse.json(
        { error: { code: "totp_invalid", message: "Código 2FA incorrecto" } },
        { status: 401 }
      );
    }
  }

  // 4) Resolver workspace por defecto del user (la primera membership)
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { joinedAt: "asc" },
    include: { workspace: { select: { id: true, name: true, slug: true } } }
  });
  if (!membership) {
    return NextResponse.json(
      { error: { code: "no_workspace", message: "Tu cuenta no pertenece a ningún workspace" } },
      { status: 403 }
    );
  }

  // 5) Revocar la API key "extension" anterior de este user (si la
  // hay) y crear una nueva. Un dispositivo nuevo = key nueva — más
  // sencillo de auditar y rotar que mantener N activas por device.
  const keyName = `extension:${deviceLabel}`;
  await prisma.apiKey.updateMany({
    where: {
      workspaceId: membership.workspaceId,
      userId: user.id,
      name: { startsWith: "extension:" },
      revokedAt: null
    },
    data: { revokedAt: new Date() }
  });

  const prefix = PREFIX + randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const hashed = await bcrypt.hash(secret, 10);
  const apiKey = await prisma.apiKey.create({
    data: {
      workspaceId: membership.workspaceId,
      userId: user.id,
      name: keyName,
      prefix,
      hashed,
      scopes: ["*"],
      // Caduca a 90 días — el user vuelve a loguearse desde la
      // extensión y se renueva.
      expiresAt: new Date(Date.now() + 90 * 24 * 3600_000)
    }
  });

  await recordLoginAttempt({ email, ip, userAgent, success: true });
  await recordAudit({
    workspaceId: membership.workspaceId,
    actorId: user.id,
    action: "extension.login",
    targetType: "API_KEY",
    targetId: apiKey.id,
    ip,
    userAgent,
    meta: { deviceLabel }
  });

  return NextResponse.json({
    ok: true,
    token: `${prefix}.${secret}`,
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    workspace: {
      id: membership.workspaceId,
      name: membership.workspace.name,
      slug: membership.workspace.slug
    },
    hasTotp: userHasTotp,
    expiresAt: apiKey.expiresAt
  });
}
