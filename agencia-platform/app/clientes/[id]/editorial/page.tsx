import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ClienteEditorialForm from "@/components/clientes/ClienteEditorialForm";
import { prisma } from "@/lib/db/prisma";
import { getSessionWorkspaceId } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { defaultDimensionsByFormat, type DimensionsByFormat, type ReferenceImage, type FontEntry, type PatternTemplate, type DriveSubfolder } from "@/lib/editorial/client-meta";

export const dynamic = "force-dynamic";

export default async function ClienteEditorialPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  const client = await prisma.client.findFirst({
    where: { id: params.id, workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      brandBrief: true,
      website: true,
      brandColorPrimary: true,
      brandColorAccent: true,
      brandColorText: true,
      logoUrl: true,
      logoPosition: true,
      visualPattern: true,
      refsFidelity: true,
      competitors: true,
      dimensionsByFormat: true,
      referenceImages: true,
      patternTemplates: true,
      fonts: true,
      styleGuideCached: true,
      styleGuideHash: true,
      driveMode: true,
      driveRootId: true,
      driveSubfolders: true,
      imageModel: true,
      metaAdAccountId: true,
      metaPageId: true,
      metaInstagramId: true,
      metaLeadEmails: true
    }
  });
  if (!client) notFound();

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href={`/clientes/${client.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a {client.name}
      </Link>

      <PageHeader
        title={`Configuración editorial · ${client.name}`}
        description="Brief, branding, colores, fuentes, refs visuales y formato de las publicaciones generadas con IA."
      />

      <ClienteEditorialForm
        initial={{
          id: client.id,
          name: client.name,
          brandBrief: client.brandBrief,
          website: client.website,
          brandColorPrimary: client.brandColorPrimary,
          brandColorAccent: client.brandColorAccent,
          brandColorText: client.brandColorText,
          logoUrl: client.logoUrl,
          logoPosition: client.logoPosition,
          visualPattern: client.visualPattern,
          refsFidelity: client.refsFidelity,
          competitors: client.competitors,
          dimensionsByFormat: (client.dimensionsByFormat as DimensionsByFormat | null) ?? defaultDimensionsByFormat(),
          referenceImages: (client.referenceImages as ReferenceImage[] | null) ?? [],
          patternTemplates: (client.patternTemplates as PatternTemplate[] | null) ?? [],
          fonts: (client.fonts as FontEntry[] | null) ?? [],
          styleGuideCached: client.styleGuideCached,
          styleGuideHash: client.styleGuideHash,
          driveMode: client.driveMode,
          driveRootId: client.driveRootId,
          driveSubfolders: (client.driveSubfolders as DriveSubfolder[] | null) ?? [],
          imageModel: client.imageModel,
          metaAdAccountId: (client as any).metaAdAccountId ?? null,
          metaPageId: (client as any).metaPageId ?? null,
          metaInstagramId: (client as any).metaInstagramId ?? null,
          metaLeadEmails: (client as any).metaLeadEmails ?? null
        }}
      />
    </div>
  );
}
