import { prisma } from "@/lib/db/prisma";
import { RIXUS_ISSUER_PROFILE } from "./invoice-form";

/** Completa la ficha RIXUS existente sin tocar logo, email, IBAN ni preferencia. */
export async function completeRixusIssuerProfile(workspaceId: string): Promise<void> {
  await prisma.invoiceIssuer.updateMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { taxId: RIXUS_ISSUER_PROFILE.taxId },
        { name: { contains: "Rixus Solutions", mode: "insensitive" } }
      ]
    },
    data: RIXUS_ISSUER_PROFILE
  });
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
    await prisma.invoice.updateMany({
      where: { workspaceId, issuerId: issuer.id, status: "DRAFT", deletedAt: null },
      data: {
        issuerSnapshot: {
          name: issuer.name,
          legalName: issuer.legalName,
          taxId: issuer.taxId,
          address: issuer.address,
          postalCode: issuer.postalCode,
          city: issuer.city,
          province: issuer.province,
          countryCode: issuer.countryCode,
          email: issuer.email,
          phone: issuer.phone,
          web: issuer.web,
          iban: issuer.iban,
          logoUrl: issuer.logoUrl,
          personType: issuer.personType,
          residenceType: issuer.residenceType
        }
      }
    });
  }
}
