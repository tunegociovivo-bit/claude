import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings } from "@/lib/settings";
import AppShell from "@/components/AppShell";
import PipelineClient from "./PipelineClient";
import { classifyCallIntent } from "@/lib/calls";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  if (!workspaceId) redirect("/login");

  const [settings, contacts] = await Promise.all([
    getWorkspaceSettings(workspaceId),
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
    nextAppointment: c.appointments[0]?.startsAt?.toISOString() ?? null,
    callSummary: c.calls[0]?.summary ?? null,
    callIntent: classifyCallIntent(c.calls[0]?.summary ?? null, c.calls[0]?.transcript ?? null),
  }));

  return (
    <AppShell>
      <PipelineClient
        columns={[...settings.pipeline.columns].sort((a, b) => a.order - b.order)}
        initialCards={cards}
      />
    </AppShell>
  );
}
