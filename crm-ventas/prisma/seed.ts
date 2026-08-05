import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@crm.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "admin1234";
  const workspaceName = process.env.SEED_WORKSPACE_NAME || "Mi Negocio";
  const slug = workspaceName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`El usuario ${email} ya existe; no se hace nada.`);
    return;
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      slug: slug || "negocio",
      settings: {
        vapiWebhookToken: randomToken(),
        whatsappWebhookToken: randomToken(),
      },
    },
  });

  await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: "Admin",
      role: "ADMIN",
    },
  });

  console.log("Seed completado:");
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);
  console.log(`  Login:     ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
