import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings } from "@/lib/settings";
import AppShell from "@/components/AppShell";
import PipelineWorkspace from "./PipelineWorkspace";
import { classifyCallIntent } from "@/lib/calls";
import { getLeadsState } from "@/lib/leads/settings";
import { readAttempts, readLeadInfo } from "@/lib/leads/config";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { vista?: string; contacto?: string };
}) {
  // Revalidado en BD (usuario aún miembro, workspace no bloqueado u operador).
  const member = await resolveSessionMember();
  if (!member) redirect("/login");
  const workspaceId = member.workspaceId;

  const [settings, leads, contacts] = await Promise.all([
    getWorkspaceSettings(workspaceId),
    getLeadsState(workspaceId),
    prisma.contact.findMany({
      where: { workspaceId },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: {
        appointments: {
          where: { status: { not: "cancelada" }, startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
          take: 1,
          select: { startsAt: true },
        },
        calls: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { summary: true, transcript: true },
        },
      },
    }),
  ]);

  const cards = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    stage: c.stage,
    order: c.order,
    source: c.source,
    notes: c.notes,
    leadStatus: c.leadStatus,
    email: c.email,
    // Datos del formulario de Meta (los 5 más recientes) para la tarjeta y la ficha.
    leadEntries: readLeadInfo(c.leadInfo).entries.slice(0, 5),
    attempts: readAttempts(c.contactAttempts).length,
    nextAppointment: c.appointments[0]?.startsAt?.toISOString() ?? null,
    callSummary: c.calls[0]?.summary ?? null,
    callIntent: classifyCallIntent(c.calls[0]?.summary ?? null, c.calls[0]?.transcript ?? null),
  }));

  return (
    <AppShell>
      <PipelineWorkspace
        columns={[...settings.pipeline.columns].sort((a, b) => a.order - b.order)}
        initialCards={cards}
        leadStatuses={leads.enabled ? leads.statuses : null}
        initialView={searchParams?.vista === "whatsapp" || searchParams?.contacto ? "whatsapp" : "tablero"}
        initialContactId={typeof searchParams?.contacto === "string" ? searchParams.contacto : null}
      />
    </AppShell>
  );
}
