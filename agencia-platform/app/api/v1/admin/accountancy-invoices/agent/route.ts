import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { prisma } from "@/lib/db/prisma";
import { buildCollectorTarget } from "@/lib/accountancy-invoices/collector";
import { refreshRunStatus } from "@/lib/accountancy-invoices/service";
import { syncAccountancyRunItemExpenses } from "@/lib/accountancy-invoices/expense-ledger";
import { describeMetaFailure, isGoogleAdsAutoRetryError, nextGoogleAdsFailure, pickGoogleAdsAgentKey } from "@/lib/accountancy-invoices/agents";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const agentKey = String(req.headers.get("x-hub-browser-agent") || "").trim().slice(0, 100);
  const agentLabel = String(req.headers.get("x-hub-browser-agent-label") || "Perfil Chrome").trim().slice(0, 100);
  const version = String(req.headers.get("x-hub-extension-version") || "").trim().slice(0, 30) || null;
  if (!agentKey) throw new ApiError(400, "missing_agent", "La extensión debe registrar este perfil de Chrome");
  await prisma.accountancyBrowserAgent.upsert({
    where: { workspaceId_agentKey: { workspaceId: api.workspaceId, agentKey } },
    create: { workspaceId: api.workspaceId, agentKey, label: agentLabel, version, lastHeartbeatAt: new Date() },
    update: { label: agentLabel, version, lastHeartbeatAt: new Date() }
  });
  // Registering a Chrome profile must never silently assign every Meta account
  // to it. Different accounts can belong to different Meta user sessions and
  // must be routed explicitly from the Hub before any download is claimed.
  if (req.nextUrl.searchParams.get("registerOnly") === "1") {
    return NextResponse.json({ ok: true, registered: true });
  }
  // Google Ads lo descarga el perfil activo (no el registrado más antiguo:
  // tras reinstalar la extensión ese perfil ya no existe y bloqueaba la cola).
  const agents = await prisma.accountancyBrowserAgent.findMany({ where: { workspaceId: api.workspaceId }, select: { agentKey: true, createdAt: true, lastHeartbeatAt: true } });
  const ownsGoogleAds = pickGoogleAdsAgentKey(agents) === agentKey;
  const allowedSources = ownsGoogleAds ? ["GOOGLE_ADS", "META"] : ["META"];
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
  await prisma.accountancyInvoiceRunItem.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore }, run: { workspaceId: api.workspaceId } },
    data: { status: "PENDING", startedAt: null, error: "Reintentada automáticamente tras interrumpirse la descarga anterior" }
  });
  const item = await prisma.accountancyInvoiceRunItem.findFirst({
    where: {
      status: "PENDING",
      source: { in: allowedSources },
      run: { workspaceId: api.workspaceId },
      OR: [
        ...(ownsGoogleAds ? [{ source: "GOOGLE_ADS" }] : []),
        { source: "META", client: { connectionRef: agentKey } }
      ]
    },
    include: { client: true, run: { select: { id: true, periodKey: true, periodFrom: true, periodTo: true } } },
    orderBy: { createdAt: "asc" }
  });
  if (!item) return NextResponse.json({ item: null });
  let target;
  try {
    target = buildCollectorTarget({ source: item.source, externalAccountId: item.client?.externalAccountId, periodFrom: item.run.periodFrom, periodTo: item.run.periodTo });
  } catch (error: any) {
    await prisma.accountancyInvoiceRunItem.update({ where: { id: item.id }, data: { status: "FAILED", error: String(error?.message || error).slice(0, 500), finishedAt: new Date() } });
    await refreshRunStatus(item.runId);
    return NextResponse.json({ skipped: item.id, reason: String(error?.message || error), retry: true });
  }
  // En Google Ads se conserva el contador de reintentos automáticos (viaja
  // en el mensaje de error) para que el siguiente fallo sepa cuántos lleva.
  const keepError = item.source === "GOOGLE_ADS" && isGoogleAdsAutoRetryError(item.error) ? item.error : null;
  const claimed = await prisma.accountancyInvoiceRunItem.updateMany({ where: { id: item.id, status: "PENDING", run: { workspaceId: api.workspaceId } }, data: { status: "RUNNING", startedAt: new Date(), error: keepError } });
  if (!claimed.count) return NextResponse.json({ item: null });
  await prisma.accountancyInvoiceRun.update({ where: { id: item.runId }, data: { status: "RUNNING", startedAt: new Date() } });
  return NextResponse.json({ item: { id: item.id, clientName: item.clientName, source: item.source, externalAccountId: item.client?.externalAccountId, connectionRef: item.client?.connectionRef, periodKey: item.run.periodKey, periodFrom: item.run.periodFrom, periodTo: item.run.periodTo, target } });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req: NextRequest, { api }) => {
  await requireAdmin(api);
  const body = await req.json();
  if (!body.id || !["DOWNLOADED", "FAILED", "SKIPPED"].includes(body.status)) throw new ApiError(400, "bad_result", "Resultado no válido");
  const current = await prisma.accountancyInvoiceRunItem.findFirst({ where: { id: body.id, run: { workspaceId: api.workspaceId } } });
  if (!current) throw new ApiError(404, "not_found", "Cuenta de ejecución no encontrada");
  let error: string | null = body.error ? String(body.error).slice(0, 900) : null;
  if (body.status === "FAILED" && current.source === "GOOGLE_ADS" && current.status === "RUNNING") {
    const failure = nextGoogleAdsFailure(current.error, error || "");
    if (failure.retry) {
      // Vuelve a la cola: la extensión lo recoge en su siguiente consulta.
      const requeued = await prisma.accountancyInvoiceRunItem.updateMany({
        where: { id: current.id, status: "RUNNING" },
        data: { status: "PENDING", error: failure.error.slice(0, 1000), startedAt: null, finishedAt: null }
      });
      if (requeued.count) return NextResponse.json({ ok: true, retrying: true });
    }
    error = failure.error;
  }
  if (body.status === "FAILED" && current.source === "META" && error) {
    const client = current.clientId ? await prisma.accountancyInvoiceClient.findFirst({ where: { id: current.clientId, workspaceId: api.workspaceId }, select: { externalAccountId: true, connectionRef: true } }) : null;
    const profile = client?.connectionRef ? await prisma.accountancyBrowserAgent.findFirst({ where: { workspaceId: api.workspaceId, agentKey: client.connectionRef }, select: { label: true, customLabel: true } }) : null;
    error = describeMetaFailure(error, { accountId: client?.externalAccountId, profileLabel: profile?.customLabel || profile?.label });
  }
  const item = await prisma.accountancyInvoiceRunItem.update({
    where: { id: current.id },
    data: { status: body.status, invoiceCount: Math.max(0, Number(body.invoiceCount) || 0), amountCents: Math.max(0, Number(body.amountCents) || 0), currency: body.currency || "EUR", files: Array.isArray(body.files) ? body.files.slice(0, 200) : undefined, error: error ? error.slice(0, 1000) : null, finishedAt: new Date() }
  });
  if (item.status === "DOWNLOADED" && item.source === "GOOGLE_ADS") await syncAccountancyRunItemExpenses(item.id);
  await refreshRunStatus(item.runId);
  return NextResponse.json({ ok: true, item });
});
