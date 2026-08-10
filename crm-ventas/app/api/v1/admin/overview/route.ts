import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireOperator } from "@/lib/auth";
import { calculateDailyCost } from "@/lib/admin/usage";
import { getGlobalPrompt, saveGlobalPrompt } from "@/lib/admin/config";

function madridDayStart() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const middayUtc = new Date(`${value("year")}-${value("month")}-${value("day")}T12:00:00Z`);
  const zone = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" })
    .formatToParts(middayUtc).find((part) => part.type === "timeZoneName")?.value ?? "GMT+01:00";
  const offset = zone.replace("GMT", "") || "+00:00";
  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00${offset}`);
}

export async function GET() {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  const since = madridDayStart();
  const callMinuteRate = Number(process.env.ADMIN_CALL_COST_PER_MINUTE || 0.15);
  const whatsappMessageRate = Number(process.env.ADMIN_WHATSAPP_COST_PER_MESSAGE || 0.005);
  const usdToEurRate = Number(process.env.ADMIN_USD_TO_EUR_RATE || 0.86);
  const workspaces = await prisma.workspace.findMany({
    orderBy: { name: "asc" },
    include: {
      users: { where: { role: "ADMIN" }, select: { email: true }, take: 1 },
      calls: { where: { createdAt: { gte: since } }, select: { durationSec: true, providerCost: true } },
      messages: { where: { createdAt: { gte: since }, direction: "in" }, select: { id: true } },
    },
  });
  const clients = workspaces.map((workspace) => {
    const cost = calculateDailyCost({
      calls: workspace.calls.map((call) => ({
        ...call,
        providerCost: typeof call.providerCost === "number" ? call.providerCost * usdToEurRate : null,
      })),
      inboundWhatsappMessages: workspace.messages.length,
      callMinuteRate,
      whatsappMessageRate,
    });
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      email: workspace.users[0]?.email ?? "—",
      isBlocked: workspace.isBlocked,
      adminNotes: workspace.adminNotes ?? "",
      callsToday: workspace.calls.length,
      whatsappToday: workspace.messages.length,
      minutesToday: Math.round(workspace.calls.reduce((sum, call) => sum + (call.durationSec ?? 0), 0) / 6) / 10,
      ...cost,
    };
  });
  return NextResponse.json({
    since: since.toISOString(),
    currency: "EUR",
    rates: { callMinuteRate, whatsappMessageRate },
    globalPrompt: await getGlobalPrompt(),
    clients,
  });
}

export async function PUT(request: NextRequest) {
  try { await requireOperator(); } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const globalPrompt = await saveGlobalPrompt(body.globalPrompt);
  return NextResponse.json({ ok: true, globalPrompt });
}
