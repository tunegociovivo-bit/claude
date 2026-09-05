import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/facturacion/sepa/agent";
import { getRecentSepaDiagnostics, notifyPendingSignatureInvoices, recoverRecentSepaApprovals, syncRecentHoldedApprovals } from "@/lib/facturacion/sepa/diagnostics";
import { probeHoldedInvoicePayload } from "@/lib/integrations/holded";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const items = await getRecentSepaDiagnostics(agent.workspaceId, 50);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req.headers.get("authorization") ?? "");
  if (!agent) return NextResponse.json({ error: { code: "unauthorized", message: "Agente no autorizado" } }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.action === "probe-holded") {
    return NextResponse.json({ ok: true, probe: await probeHoldedInvoicePayload(agent.workspaceId) });
  }
  if (body?.action === "sync") {
    const result = await syncRecentHoldedApprovals(agent.workspaceId);
    return NextResponse.json({ ok: true, ...result });
  }
  const invoiceNumbers: string[] = Array.isArray(body?.invoiceNumbers)
    ? Array.from(new Set<string>(body.invoiceNumbers.map((value: unknown) => String(value).trim()).filter((value: string) => /^FAC-\d+$/i.test(value)))).slice(0, 50)
    : [];
  if (body?.action === "notify-pending-signatures") {
    if (!invoiceNumbers.length) return NextResponse.json({ error: { code: "invoice_numbers_required", message: "Indica las facturas concretas" } }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await notifyPendingSignatureInvoices(agent.workspaceId, invoiceNumbers)) });
  }
  if (!invoiceNumbers.length) {
    return NextResponse.json({ error: { code: "invoice_numbers_required", message: "Indica las facturas concretas que deben recuperarse" } }, { status: 400 });
  }
  const result = await recoverRecentSepaApprovals(agent.workspaceId, invoiceNumbers);
  return NextResponse.json({ ok: true, ...result });
}
