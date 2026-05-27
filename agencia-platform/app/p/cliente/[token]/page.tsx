import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import ClientPortalView from "./ClientPortalView";

export const dynamic = "force-dynamic";

/**
 * Portal del cliente — vista pública (sin login) en la que el cliente
 * ve qué tiene su agencia en marcha: proyectos, próximos eventos y un
 * resumen del estado del calendario editorial. Si hay publicaciones
 * pendientes de su revisión, le ofrece pasar al panel de aprobación
 * que ya existía en /p/editorial/[token].
 *
 * Reusa el ClientApprovalLink: el mismo token vale para ambas vistas.
 */
export default async function ClientPortalPage({ params }: { params: { token: string } }) {
  const link = await prisma.clientApprovalLink.findUnique({
    where: { token: params.token },
    select: { id: true, revokedAt: true, expiresAt: true }
  });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
    notFound();
  }
  return <ClientPortalView token={params.token} />;
}
