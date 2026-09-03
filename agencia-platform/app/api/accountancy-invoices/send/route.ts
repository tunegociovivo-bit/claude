import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/accountancy-invoices/domain";
import { deliverAccountancyRun } from "@/lib/accountancy-invoices/delivery";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" } });
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json();
  const recipients = validateRecipients(body.recipients);
  try {
    const sent = await deliverAccountancyRun({ runId: String(body.runId || ""), workspaceId, userId, recipients });
    return NextResponse.json({ ok: true, sent });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 409 });
  }
}
