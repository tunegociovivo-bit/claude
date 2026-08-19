import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { readMetaTokenByConnection } from "@/lib/meta/connection";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const metadataObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function sendMetaLeadQuality(leadId: string, workspaceId: string, eventName: "QualifiedLead" | "ConvertedLead") {
  const lead = await prisma.metaLeadAttribution.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new Error("Lead no encontrado");
  const metadata = metadataObject(lead.metadata);
  const profile = await prisma.metaClientProfile.findUnique({ where: { workspaceId_adAccountId: { workspaceId, adAccountId: lead.adAccountId } }, select: { metaConnectionId: true } });
  const connectionId = String(metadata.metaConnectionId ?? profile?.metaConnectionId ?? "");
  const pixelId = String(metadata.pixelId ?? "");
  if (!connectionId || !/^\d+$/.test(pixelId)) return { sent: false, reason: "dataset_not_available" } as const;
  const token = await readMetaTokenByConnection(workspaceId, connectionId);
  if (!token) return { sent: false, reason: "connection_not_available" } as const;
  const userData: Record<string, string[]> = { external_id: [hash(lead.externalLeadId)] };
  if (lead.email) userData.em = [hash(lead.email.trim().toLowerCase())];
  if (lead.phone) userData.ph = [hash(lead.phone.replace(/\D/g, ""))];
  const eventId = `${lead.externalLeadId}:${eventName}`;
  const payload = [{ event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: "system_generated", user_data: userData }];
  const response = await fetch(`https://graph.facebook.com/v23.0/${pixelId}/events`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: token, data: JSON.stringify(payload) }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Meta CAPI HTTP ${response.status}`);
  return { sent: true, eventId } as const;
}
