import { prisma } from "@/lib/db/prisma";
import { RIXUS_ISSUER_PROFILE } from "./invoice-form";
import { RIXUS_LOGO_DATA_URI } from "./rixus-logo";

/** Completa la ficha RIXUS existente sin tocar logo, email, IBAN ni preferencia. */
export async function completeRixusIssuerProfile(workspaceId: string): Promise<void> {
  const issuers = await prisma.invoiceIssuer.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { taxId: RIXUS_ISSUER_PROFILE.taxId },
        { name: { contains: "Rixus Solutions", mode: "insensitive" } }
      ]
    }
  });
  for (const issuer of issuers) {
    const missing: Record<string, string> = {};
    for (const [key, value] of Object.entries(RIXUS_ISSUER_PROFILE)) {
      const current = issuer[key as keyof typeof issuer];
      if (current == null || (typeof current === "string" && !current.trim())) missing[key] = value;
    }
    if (!issuer.logoUrl?.trim()) missing.logoUrl = RIXUS_LOGO_DATA_URI;
    if (Object.keys(missing).length === 0) continue;
    const completed = await prisma.invoiceIssuer.update({ where: { id: issuer.id }, data: missing });
    await prisma.invoice.updateMany({
      where: { workspaceId, issuerId: issuer.id, status: "DRAFT", deletedAt: null },
      data: {
        issuerSnapshot: {
          name: completed.name,
          legalName: completed.legalName,
          taxId: completed.taxId,
          address: completed.address,
          postalCode: completed.postalCode,
          city: completed.city,
          province: completed.province,
          countryCode: completed.countryCode,
          email: completed.email,
          phone: completed.phone,
          web: completed.web,
          iban: completed.iban,
          logoUrl: completed.logoUrl,
          personType: completed.personType,
          residenceType: completed.residenceType
        }
      }
    });
    const documentsWithoutLogo = await prisma.invoice.findMany({
      where: { workspaceId, issuerId: issuer.id, deletedAt: null },
      select: { id: true, issuerSnapshot: true }
    });
    for (const document of documentsWithoutLogo) {
      const snapshot = (document.issuerSnapshot ?? {}) as Record<string, unknown>;
      if (typeof snapshot.logoUrl === "string" && snapshot.logoUrl.trim()) continue;
      await prisma.invoice.update({
        where: { id: document.id },
        data: { issuerSnapshot: { ...snapshot, logoUrl: completed.logoUrl } }
      });
    }
  }
}
