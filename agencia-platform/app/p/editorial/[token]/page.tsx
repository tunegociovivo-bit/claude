import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import PublicApprovalView from "./PublicApprovalView";

export const dynamic = "force-dynamic";

export default async function PublicApprovalPage({ params }: { params: { token: string } }) {
  // Validación rápida server-side; el componente cliente recargará vía API.
  const link = await prisma.clientApprovalLink.findUnique({
    where: { token: params.token },
    select: { id: true, revokedAt: true, expiresAt: true }
  });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    notFound();
  }
  return <PublicApprovalView token={params.token} />;
}
