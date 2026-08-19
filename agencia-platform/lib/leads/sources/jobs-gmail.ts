import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function accessToken(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const enc = (ws?.settings as any)?.integrations?.googleJobsInbox?.refreshTokenEncrypted;
  if (!enc) return null;
  const refreshToken = decryptSecret(enc);
  if (!refreshToken) return null;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw Object.assign(new Error("Google ha rechazado la conexión del buzón."), { authenticationFailed: response.status === 400 || response.status === 401 });
  return (await response.json()).access_token;
}

async function gmailFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }
  });
  if (!response.ok) throw Object.assign(new Error(`Gmail API ${response.status}`), { authenticationFailed: response.status === 401 });
  return response;
}

export type GmailJobMessage = { id: string; raw: Buffer };

export async function googleJobsInboxConnected(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  return !!(ws?.settings as any)?.integrations?.googleJobsInbox?.refreshTokenEncrypted;
}

export async function testGoogleJobsInbox(workspaceId: string): Promise<{ ok: boolean; unseen?: number; messages?: GmailJobMessage[] }> {
  const token = await accessToken(workspaceId);
  if (!token) return { ok: false };
  const list = await gmailFetch(token, "/messages?" + new URLSearchParams({ q: "is:unread", maxResults: "60" }));
  const body = await list.json();
  return { ok: true, unseen: Number(body.resultSizeEstimate ?? body.messages?.length ?? 0) };
}

export async function fetchUnreadGoogleMessages(workspaceId: string): Promise<GmailJobMessage[] | null> {
  const token = await accessToken(workspaceId);
  if (!token) return null;
  const list = await gmailFetch(token, "/messages?" + new URLSearchParams({ q: "is:unread", maxResults: "60" }));
  const ids: string[] = ((await list.json()).messages ?? []).map((m: any) => m.id).filter(Boolean);
  const messages: GmailJobMessage[] = [];
  for (const id of ids) {
    const response = await gmailFetch(token, `/messages/${encodeURIComponent(id)}?format=raw`);
    const raw = (await response.json()).raw;
    if (raw) messages.push({ id, raw: Buffer.from(raw, "base64url") });
  }
  return messages;
}

export async function markGoogleMessageRead(workspaceId: string, id: string): Promise<void> {
  const token = await accessToken(workspaceId);
  if (!token) return;
  await gmailFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] })
  });
}
