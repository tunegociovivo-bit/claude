import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { getVapiRecordingUrl, VapiApiError } from "@/lib/vapi/client";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const call = await prisma.call.findFirst({
    where: { id: params.id, workspaceId },
    select: { providerCallId: true },
  });
  if (!call?.providerCallId) {
    return NextResponse.json({ error: "Grabación no encontrada" }, { status: 404 });
  }
  try {
    return NextResponse.redirect(await getVapiRecordingUrl(call.providerCallId));
  } catch (error) {
    const status = error instanceof VapiApiError ? error.status : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo abrir la grabación" },
      { status }
    );
  }
}
