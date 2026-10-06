/**
 * POST /api/v1/admin/clients/:id/api-keys/test  { provider }
 * Comprueba la clave que usa ese cliente para el servicio (la suya o la de
 * Negocio Vivo) contra el propio servicio, sin generar contenido.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { isApiProvider, resolveApiKey, testApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!isApiProvider(body.provider)) return NextResponse.json({ error: "Servicio no válido" }, { status: 400 });
  const workspace = await prisma.workspace.findUnique({ where: { id: params.id }, select: { settings: true } });
  if (!workspace) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  const { key, source } = resolveApiKey(workspace.settings, body.provider);
  if (!key) return NextResponse.json({ ok: false, source, message: "No hay clave: ni propia ni de Negocio Vivo" });
  const result = await testApiKey(body.provider, key);
  return NextResponse.json({ ...result, source });
}
