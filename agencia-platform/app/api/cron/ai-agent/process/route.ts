/**
 * Cron de Sonia: procesa AiAgentRun en PENDING.
 *
 * Debe llamarse cada 1-2 min (GitHub Actions / Railway cron). Coge
 * hasta N runs PENDING de cualquier workspace, los marca RUNNING,
 * ejecuta el agent loop, persiste el resultado, y notifica al
 * requester si está definido.
 *
 * Tope por invocación: por defecto 3 runs simultáneos. Cada uno tarda
 * decenas de segundos a minutos (depende de los tool calls de Claude).
 * Mantener el tope bajo evita timeouts del cron (Railway/GH Actions
 * suelen tener 10-15 min por job).
 *
 * Seguridad: header `Authorization: Bearer ${CRON_SECRET}` o
 * `?secret=...`. Sin secret → 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { processOneRun } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min — agent loops pueden tardar

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 503 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 10);

  // Cogemos los más antiguos primero (FIFO).
  const pending = await prisma.aiAgentRun.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true }
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results = [];
  for (const p of pending) {
    results.push(await processOneRun(p.id));
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export const POST = GET;
