import { prisma } from "@/lib/prisma";
import { normalizeGlobalPrompt } from "@/lib/admin/usage";

export async function getGlobalPrompt() {
  const config = await prisma.globalAdminConfig.findUnique({ where: { id: "global" } });
  return config?.globalPrompt ?? "";
}

export async function saveGlobalPrompt(value: unknown) {
  const globalPrompt = normalizeGlobalPrompt(value);
  await prisma.globalAdminConfig.upsert({
    where: { id: "global" },
    update: { globalPrompt },
    create: { id: "global", globalPrompt },
  });
  return globalPrompt;
}
