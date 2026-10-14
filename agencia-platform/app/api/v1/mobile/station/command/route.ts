import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { markViewer, queueCommand, type StationCommand } from "@/lib/mobile/station-relay";

export const dynamic = "force-dynamic";

const point = z.number().int().min(0).max(10_000);
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap"), deviceSerial: z.string().min(1).max(160), x: point, y: point }).strict(),
  z.object({ type: z.literal("swipe"), deviceSerial: z.string().min(1).max(160), x: point, y: point, x2: point, y2: point }).strict(),
  z.object({ type: z.enum(["back", "home", "recents"]), deviceSerial: z.string().min(1).max(160) }).strict(),
  z.object({ type: z.literal("text"), deviceSerial: z.string().min(1).max(160), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("openUrl"), deviceSerial: z.string().min(1).max(160), url: z.string().url().max(2048).refine((value) => /^https:\/\//i.test(value), "Solo enlaces https") }).strict()
]);

/** Orden de control remoto: la ejecuta la estación en el móvil real en el siguiente envío de pantalla. */
export const POST = withApi({ scope: "*", rate: "mobile_station" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Orden no válida");
  const { deviceSerial, ...rest } = parsed.data;
  if (!phones.some((phone) => phone.active && phone.deviceSerial === deviceSerial)) throw new ApiError(404, "not_found", "Móvil no encontrado");
  const command = { ...rest, id: crypto.randomUUID(), at: Date.now(), by: api.userId ?? "" } as StationCommand;
  queueCommand(api.workspaceId, deviceSerial, command);
  markViewer(api.workspaceId, deviceSerial);
  return NextResponse.json({ ok: true, id: command.id });
});
