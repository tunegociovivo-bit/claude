import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";
import sharp from "sharp";

export const dynamic = "force-dynamic";
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = withApi({ scope: "time_tracking:write" }, async (req: NextRequest, { api }) => {
  if (!api.userId) throw new ApiError(401, "user_required", "El agente debe estar vinculado a un usuario");
  if (!isStorageEnabled()) throw new ApiError(503, "storage_disabled", "Almacenamiento no configurado");
  const member = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId }, select: { id: true } });
  if (!member) throw new ApiError(403, "forbidden", "Usuario fuera del espacio");
  const policy = await prisma.timeTrackerPolicy.findUnique({ where: { userId: api.userId } });
  if (policy?.trackingEnabled === false || policy?.screenshotsEnabled === false) throw new ApiError(403, "screenshots_disabled", "Las capturas están desactivadas para este trabajador");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || !["image/jpeg", "image/webp"].includes(file.type)) throw new ApiError(400, "invalid_image", "Solo se admiten JPEG o WebP");
  if (!file.size || file.size > MAX_BYTES) throw new ApiError(413, "too_large", "La captura supera 8 MB");
  const deviceId = String(form.get("deviceId") ?? "").slice(0, 120);
  if (deviceId.length < 4) throw new ApiError(400, "device_required", "Falta el dispositivo");
  const capturedAt = new Date(String(form.get("capturedAt") ?? ""));
  if (!Number.isFinite(capturedAt.getTime())) throw new ApiError(400, "invalid_date", "Fecha de captura inválida");
  const retentionDays = policy?.retentionDays ?? Math.min(90, Math.max(1, Number(form.get("retentionDays") ?? 30)));
  const expiresAt = new Date(capturedAt.getTime() + retentionDays * 86400000);
  const s3Key = buildS3Key({ workspaceId: api.workspaceId, targetType: "TIME_TRACKING_SCREENSHOT", targetId: api.userId, filename: `${capturedAt.toISOString()}.webp` });
  let body: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (policy?.blurScreenshots) body = await sharp(body).blur(12).webp({ quality: 68 }).toBuffer();
  await uploadBuffer({ s3Key, body, contentType: "image/webp" });
  const record = await prisma.timeTrackerScreenshot.create({ data: {
    workspaceId: api.workspaceId, userId: api.userId, deviceId, capturedAt, expiresAt, s3Key,
    appName: String(form.get("appName") ?? "").slice(0, 160) || null,
    blurred: policy?.blurScreenshots === true || String(form.get("blurred")) === "true",
    width: Number(form.get("width")) || null, height: Number(form.get("height")) || null
  } });
  return NextResponse.json({ id: record.id, capturedAt: record.capturedAt }, { status: 201 });
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const membership = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId }, select: { role: true } });
  if (!membership) throw new ApiError(403, "forbidden", "Acceso denegado");
  const url = new URL(req.url);
  const requestedUser = url.searchParams.get("userId");
  const userId = membership.role === "ADMIN" ? requestedUser || undefined : api.userId;
  const rows = await prisma.timeTrackerScreenshot.findMany({
    where: { workspaceId: api.workspaceId, expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}) },
    orderBy: { capturedAt: "desc" }, take: 100,
    include: { user: { select: { name: true, email: true } } }
  });
  return NextResponse.json({ items: await Promise.all(rows.map(async r => ({
    id: r.id, userId: r.userId, user: r.user.name || r.user.email, capturedAt: r.capturedAt,
    appName: r.appName, blurred: r.blurred, expiresAt: r.expiresAt, url: await signedDownloadUrl(r.s3Key, 900)
  }))) });
});
