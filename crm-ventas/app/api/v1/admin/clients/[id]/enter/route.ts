import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { patchWorkspaceSettings } from "@/lib/content/settings";
import { appendOperatorAccess, enterWorkspaceToken, isActingToken } from "@/lib/admin/acting-core";
import { readSessionToken, writeSessionToken } from "@/lib/admin/acting";

export const dynamic = "force-dynamic";

// Un operador de Negocio Vivo entra en el CRM de un cliente sin usuario propio
// allí: la sesión pasa a apuntar a ese workspace (como ADMIN) hasta que pulse
// «Volver al panel». Cada petición se revalida en BD (resolveSessionMember).
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let operator: { userId: string; email: string };
  try { operator = await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });

  const workspace = await prisma.workspace.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!workspace) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const token = await readSessionToken(request);
  if (!token || token.uid !== operator.userId) return NextResponse.json({ error: "Vuelve a iniciar sesión" }, { status: 401 });

  const next = enterWorkspaceToken(token, workspace.id);
  const alreadyInside = isActingToken(token) && token.workspaceId === workspace.id;
  if (isActingToken(next) && !alreadyInside) {
    await patchWorkspaceSettings(workspace.id, (settings) => appendOperatorAccess(settings, operator.email)).catch(() => undefined);
    console.info(`[admin] ${operator.email} entra en el CRM de «${workspace.name}» (${workspace.id})`);
  }
  const response = NextResponse.json({ ok: true, workspace, redirect: "/pipeline" });
  response.headers.set("Cache-Control", "no-store");
  await writeSessionToken(request, response, next);
  return response;
}
