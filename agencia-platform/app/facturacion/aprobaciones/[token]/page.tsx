import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import AprobacionClient from "@/components/facturacion/AprobacionClient";

export const dynamic = "force-dynamic";

export default async function AprobacionPage({ params }: { params: { token: string } }) {
  // Exige usuario autenticado y ADMIN. El enlace del email NO da acceso por sí
  // solo: hay que iniciar sesión y ser administrador.
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect(`/login?callbackUrl=/facturacion/aprobaciones/${encodeURIComponent(params.token)}`);

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-2xl mx-auto pb-24">
      <PageHeader title="Aprobar remesa SEPA" description="Revisa el resumen y aprueba o rechaza. Aprobar NO firma ni ejecuta el cobro." />
      <AprobacionClient token={params.token} />
    </div>
  );
}
