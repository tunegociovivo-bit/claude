import { redirect } from "next/navigation";
import { resolveSessionMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AppShell from "@/components/AppShell";
import LlamadasClient from "./LlamadasClient";

export const dynamic = "force-dynamic";

export default async function LlamadasPage() {
  // Revalidado en BD (usuario aún miembro, workspace no bloqueado u operador).
  const member = await resolveSessionMember();
  if (!member) redirect("/login");
  const workspaceId = member.workspaceId;

  const calls = await prisma.call.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { contact: { select: { name: true } } },
  });

  return (
    <AppShell>
      <LlamadasClient
        calls={calls.map((c) => ({
          id: c.id,
          fromNumber: c.fromNumber,
          status: c.status,
          endedReason: c.endedReason,
          durationSec: c.durationSec,
          transcript: c.transcript,
          summary: c.summary,
          recordingUrl: c.recordingUrl,
          contactName: c.contact?.name ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
