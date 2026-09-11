import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBuffer, signedDownloadUrl } from "@/lib/storage/r2";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const member = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!member) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const file = await prisma.file.findFirst({
    where: { id: params.id, workspaceId, targetType: "ACCOUNTANCY_RUN_ITEM" }
  });
  if (!file) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (req.nextUrl.searchParams.get("download") === "1") {
    const body = await downloadBuffer(file.s3Key);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": file.mimeType || "application/pdf", "Content-Disposition": `attachment; filename="${file.name.replace(/["\r\n]/g, "_")}"`, "Cache-Control": "private, no-store" } });
  }
  return NextResponse.redirect(await signedDownloadUrl(file.s3Key, 15 * 60));
}
