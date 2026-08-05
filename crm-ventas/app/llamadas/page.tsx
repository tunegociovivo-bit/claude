import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AppShell from "@/components/AppShell";
import LlamadasClient from "./LlamadasClient";

export const dynamic = "force-dynamic";

export default async function LlamadasPage() {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  if (!workspaceId) redirect("/login");

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
