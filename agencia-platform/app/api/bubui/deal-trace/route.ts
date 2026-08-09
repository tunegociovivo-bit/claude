/**
 * Traza del flujo del reto.
 *   POST  → registra una etapa (público, best-effort, SIN PII). Lo llama la app
 *           y la web para marcar por dónde va la cadena del reto.
 *   GET ?token=… → devuelve la línea de tiempo de un token (solo ADMIN Bubui),
 *           para ver dónde se cortó en una prueba real.
 */
import { NextResponse } from "next/server";
import { recordDealTrace, getDealTraces } from "@/lib/bubui/deal-trace";
import { isBubuiAdmin } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  await recordDealTrace({
    token: String(body?.token ?? ""),
    stage: String(body?.stage ?? ""),
    platform: body?.platform ? String(body.platform) : undefined,
    appBuild: body?.appBuild ? String(body.appBuild) : undefined,
    source: "client"
  });
  // Siempre 200 (best-effort): no revelamos si el token existe ni bloqueamos.
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  if (!(await isBubuiAdmin(req))) {
    return NextResponse.json({ error: { code: "forbidden", message: "Solo administradores" } }, { status: 403 });
  }
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return NextResponse.json({ token: token.toLowerCase(), items: await getDealTraces(token) });
}
