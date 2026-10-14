import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { loadMobileAutomationAccess, requireSerialLinkedToWorkspace } from "@/lib/mobile/automation-access";
import { hasViewers, markViewer, readSnapshot, saveSnapshot, takeCommands } from "@/lib/mobile/station-relay";
import { markDeviceSeen } from "@/lib/mobile/thread-failover";

export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  deviceSerial: z.string().trim().min(1).max(160),
  image: z.string().regex(/^data:image\/(jpeg|webp|png);base64,/).max(600_000).optional(),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  working: z.string().max(40).default("idle")
}).strict();

/** La estación sube la pantalla reducida y recoge las órdenes de los usuarios remotos. */
export const POST = withApi({ scope: "*", rate: "mobile_station" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = uploadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Pantalla no válida");
  const phone = requireSerialLinkedToWorkspace(phones, parsed.data.deviceSerial);
  markDeviceSeen(api.workspaceId, parsed.data.deviceSerial);
  if (parsed.data.image) {
    const [header, data] = parsed.data.image.split(",", 2);
    saveSnapshot(api.workspaceId, parsed.data.deviceSerial, {
      image: Buffer.from(data ?? "", "base64"), mime: /image\/(\w+)/.exec(header ?? "")?.[0] ?? "image/jpeg",
      width: parsed.data.width, height: parsed.data.height, at: Date.now(), working: parsed.data.working, label: phone.phone || phone.label
    });
  }
  return NextResponse.json({ ok: true, wanted: hasViewers(api.workspaceId, parsed.data.deviceSerial), commands: takeCommands(api.workspaceId, parsed.data.deviceSerial) });
});

/** Última imagen de una pantalla (para verla desde otro ordenador). */
export const GET = withApi({ scope: "*", rate: "mobile_station" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId);
  const serial = new URL(req.url).searchParams.get("serial") ?? "";
  if (!phones.some((phone) => phone.active && phone.deviceSerial === serial)) throw new ApiError(404, "not_found", "Móvil no encontrado");
  markViewer(api.workspaceId, serial);
  const snapshot = readSnapshot(api.workspaceId, serial);
  if (!snapshot) return new NextResponse(null, { status: 204 });
  return new NextResponse(new Uint8Array(snapshot.image), { headers: { "Content-Type": snapshot.mime, "Cache-Control": "no-store", "X-Snapshot-At": String(snapshot.at) } });
});
