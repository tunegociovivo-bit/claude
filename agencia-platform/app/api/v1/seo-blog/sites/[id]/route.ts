import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { siteOut } from "@/lib/seo-blog/access";
import { encryptSecret } from "@/lib/ai/crypto";
import { deleteObject } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const TEXT = ["siteUrl", "wpUser", "language", "location", "sector", "tone", "ctaText", "ctaUrl", "defaultCategory", "publishTime", "imageAspect", "color"];
const LONG = ["businessInfo", "audience", "brandVoice", "compliance", "forbidden", "competitors", "visualStyle", "visualNotes"];
const INTS: Record<string, [number, number]> = { wpAuthorId: [0, 1e9], leadDays: [0, 30], wordsMin: [300, 6000], wordsMax: [400, 8000], imagesPerPost: [1, 6] };
const BOOLS = ["autoPublish", "active"];

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, include: { client: { select: { name: true } } } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  return NextResponse.json(siteOut(site));
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const b = (await req.json().catch(() => ({}))) ?? {};
  const data: Record<string, any> = {};
  for (const k of TEXT) if (typeof b[k] === "string") data[k] = b[k].trim().slice(0, 500);
  for (const k of LONG) if (k in b) data[k] = b[k] == null ? null : String(b[k]).slice(0, 20000);
  for (const [k, [min, max]] of Object.entries(INTS)) if (k in b && b[k] !== "") data[k] = Math.max(min, Math.min(max, Math.round(Number(b[k]) || 0)));
  for (const k of BOOLS) if (k in b) data[k] = !!b[k] && b[k] !== "0";
  if (typeof data.siteUrl === "string") data.siteUrl = data.siteUrl.replace(/\/+$/, "");
  if (typeof b.wpAppPassword === "string" && b.wpAppPassword.trim()) data.wpAppPasswordEnc = encryptSecret(b.wpAppPassword.trim());
  if (data.publishTime && !/^\d{2}:\d{2}$/.test(data.publishTime)) delete data.publishTime;
  if ("siteUrl" in data || "wpUser" in data || "wpAppPasswordEnc" in data) data.siteCacheAt = null;
  const r = await prisma.seoBlogSite.updateMany({ where: { id: params.id, workspaceId: api.workspaceId }, data });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, include: { client: { select: { name: true } } } });
  return NextResponse.json(siteOut(site!));
});

/** Quita el cliente del Publicador (no toca el cliente del CRM ni su web). */
export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const refs = await prisma.seoBlogRef.findMany({ where: { siteId: params.id, workspaceId: api.workspaceId }, select: { s3Key: true } });
  const r = await prisma.seoBlogSite.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!r.count) throw new ApiError(404, "not_found", "No encontrado");
  await Promise.all(refs.map((x) => deleteObject(x.s3Key).catch(() => null)));
  return NextResponse.json({ ok: true });
});
