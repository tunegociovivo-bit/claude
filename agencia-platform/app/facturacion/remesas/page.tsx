import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import RemesasClient from "@/components/facturacion/RemesasClient";
import { getSantanderProviderStatus } from "@/lib/facturacion/sepa/santander-provider";
import { getNegocioVivoIssuer } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

export default async function RemesasPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  const issuer = await getNegocioVivoIssuer(workspaceId);

  return (
    <div className="max-w-6xl mx-auto pb-24">
      <PageHeader
        title="Remesas de adeudos SEPA"
        description="Aprobación de remesas de Negocio Vivo S.C.A. Aprobar NO firma ni ejecuta el cobro: solo deja la solicitud lista para preparar en el banco."
      />
      <RemesasClient
        providerStatus={getSantanderProviderStatus()}
        issuerMissing={!issuer}
      />
    </div>
  );
}
