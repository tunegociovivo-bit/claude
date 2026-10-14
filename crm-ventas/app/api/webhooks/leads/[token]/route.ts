import { NextRequest, NextResponse } from "next/server";
import { findWorkspaceByLeadsToken } from "@/lib/leads/settings";
import { parseLeadPayload } from "@/lib/leads/config";
import { ingestLead } from "@/lib/leads/intake";
import { kickInboxWorker } from "@/lib/inbox/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Entrada de leads desde Make (formularios de Meta Lead Ads).
//   POST https://<crm>/api/webhooks/leads/<token>   (JSON)
//   { "telefono": "+34600…", "nombre": "…", "email": "…",
//     "linea": "609517110" | "Rochar",        ← número del CRM que lleva el lead
//     "tratamiento": "Injerto capilar", "campana": "…", "lead_id": "…",
//     "respuestas": { "¿Cuándo…?": "…" }, "mensaje": "…" (opcional) }
// Responde 200 aunque haya avisos (teléfono raro, número no encontrado): el
// lead nunca se pierde y Make no desactiva el escenario por errores.
// ---------------------------------------------------------------------------
const MAX_BODY = 64 * 1024;
const g = globalThis as typeof globalThis & { __leadHits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__leadHits ??= new Map<string, number[]>());

function rateLimited(key: string): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  return list.length > 120;
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ws = await findWorkspaceByLeadsToken(params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });
  // Con el módulo apagado no entra nada ni se escribe a nadie.
  if (!ws.leads.enabled) {
    return NextResponse.json({ error: "El módulo de leads está desactivado para este cliente" }, { status: 403 });
  }
  if (rateLimited(ws.id)) {
    return NextResponse.json({ error: "Demasiadas peticiones; reintentar" }, { status: 429, headers: { "Retry-After": "30" } });
  }
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Petición demasiado grande" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }
  const parsed = parseLeadPayload(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const result = await ingestLead(ws, parsed.lead);
    if (result.welcome.status === "queued") kickInboxWorker(500);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[leads-webhook] error:", error?.message);
    // 503 → Make puede reintentar; el lead_id evita duplicados.
    return NextResponse.json({ error: "No se pudo guardar el lead; reintentar" }, { status: 503, headers: { "Retry-After": "5" } });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const ws = await findWorkspaceByLeadsToken(params.token);
  if (!ws) return NextResponse.json({ error: "Token no válido" }, { status: 404 });
  return NextResponse.json({ ok: true, uso: "Envía los leads con POST (JSON) desde el módulo HTTP de Make" });
}
