/**
 * Cliente Metricool ligero — Fase 47.
 *
 * Marketing analytics multicanal: Instagram, Facebook, TikTok,
 * LinkedIn, Twitter, GMB, etc. Config en
 * settings.integrations.metricool.{ apiToken, defaultBlogId? }
 *
 * El "blogId" en Metricool es el ID de la marca/cuenta. Cada workspace
 * puede gestionar varias marcas — los tools de Sonia aceptan blogId
 * opcional y caen al default si se omite.
 *
 * Docs: https://app.metricool.com/api/api-docs.html
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const BASE = "https://app.metricool.com/api";

async function getConfig(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const cfg = (ws?.settings as any)?.integrations?.metricool ?? {};
  if (!cfg.apiToken) throw new Error("Metricool no configurado");
  const token = decryptSecret(cfg.apiToken);
  if (!token) throw new Error("Metricool token inválido");
  return { apiToken: token, defaultBlogId: cfg.defaultBlogId ?? null };
}

async function mcFetch<T = any>(workspaceId: string, path: string): Promise<T> {
  const cfg = await getConfig(workspaceId);
  const url = path.includes("?")
    ? `${BASE}${path}&userToken=${cfg.apiToken}`
    : `${BASE}${path}?userToken=${cfg.apiToken}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Metricool ${resp.status} ${path}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

export async function metricoolListBrands(opts: { workspaceId: string }) {
  return mcFetch<any[]>(opts.workspaceId, "/brands");
}

export async function metricoolGetStats(opts: {
  workspaceId: string;
  blogId?: string;
  network?: "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok" | "gmb";
  from?: string; // ISO
  to?: string; // ISO
}) {
  const cfg = await getConfig(opts.workspaceId);
  const blogId = opts.blogId ?? cfg.defaultBlogId;
  if (!blogId) throw new Error("metricool blogId no proporcionado y no hay default");
  const params = new URLSearchParams({ blogId: String(blogId) });
  if (opts.network) params.set("network", opts.network);
  if (opts.from) params.set("start", opts.from);
  if (opts.to) params.set("end", opts.to);
  return mcFetch<any>(opts.workspaceId, `/stats?${params.toString()}`);
}

export async function metricoolTest(workspaceId: string): Promise<{ ok: true; brands: number }> {
  const brands = await metricoolListBrands({ workspaceId });
  return { ok: true, brands: Array.isArray(brands) ? brands.length : 0 };
}
