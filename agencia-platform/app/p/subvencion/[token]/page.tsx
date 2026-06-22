import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import SubvencionValidateView from "./SubvencionValidateView";
import type { SubvProposalMatch } from "@/lib/bubui/subvenciones";

export const dynamic = "force-dynamic";

/**
 * Página pública (sin login) donde el comercio ve las subvenciones que le
 * encontramos y confirma con un clic que quiere que la agencia se las
 * gestione. El token es el de BubuiSubvencionProposal.
 */
export default async function SubvencionValidatePage({ params }: { params: { token: string } }) {
  const proposal = await prisma.bubuiSubvencionProposal.findUnique({
    where: { token: params.token },
    include: { business: { select: { name: true } } }
  });
  if (!proposal) notFound();

  const matches = (proposal.matches as unknown as SubvProposalMatch[]) ?? [];
  return (
    <SubvencionValidateView
      token={params.token}
      businessName={proposal.business.name}
      matches={matches}
      accepted={proposal.status === "accepted"}
    />
  );
}
