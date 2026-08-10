import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import {
  createWorkspaceSlug,
  normalizeClientEmail,
  normalizeClientName,
  validateInitialPassword,
} from "@/lib/admin/usage";

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

async function availableSlug(name: string) {
  const base = createWorkspaceSlug(name);
  let slug = base;
  let suffix = 2;
  while (await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base.slice(0, 72)}-${suffix++}`;
  }
  return slug;
}

export async function POST(request: NextRequest) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = normalizeClientName(body.name);
  const email = normalizeClientEmail(body.email);
  const password = body.password;
  const contactName = normalizeClientName(body.contactName) || "Administrador";
  if (!name) return NextResponse.json({ error: "Indica el nombre del cliente" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "Indica un correo válido" }, { status: 400 });
  if (!validateInitialPassword(password)) return NextResponse.json({ error: "La contraseña debe tener entre 8 y 128 caracteres" }, { status: 400 });
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "Ya existe un usuario con ese correo" }, { status: 409 });
  }

  const slug = await availableSlug(name);
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name,
          slug,
          settings: { vapiWebhookToken: randomToken(), whatsappWebhookToken: randomToken() },
        },
      });
      await tx.user.create({
        data: { workspaceId: created.id, email, passwordHash, name: contactName, role: "ADMIN" },
      });
      return created;
    });
    return NextResponse.json({ ok: true, workspace: { id: workspace.id, name: workspace.name, slug }, email }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo crear el cliente. Comprueba que el correo no esté en uso." }, { status: 409 });
  }
}
