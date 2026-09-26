import { prisma } from "@/lib/db/prisma";

/** Marca de la agencia para los informes/escritos (branding del workspace + usuario que firma). */
export async function reportBrand(workspaceId: string, userId?: string | null): Promise<{ agency: string; contact?: string; logoUrl?: string | null }> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, settings: true } });
  const b = (ws?.settings as any)?.branding ?? {};
  let contact: string | undefined;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).catch(() => null);
    if (u) contact = [u.name, u.email].filter(Boolean).join(" · ");
  }
  return { agency: b.name || ws?.name || "Negocio Vivo", contact, logoUrl: b.logoUrl ?? null };
}

export function pdfFilename(kind: string, client: string): string {
  const base = { cliente: "informe-resenas", google: "evidencias-google", carta: "escrito-soporte-google", mensual: "informe-mensual", evidencias: "acta-evidencias", apelacion: "apelacion-google" }[kind] ?? "informe";
  return `${base}-${client}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 90) + ".pdf";
}
