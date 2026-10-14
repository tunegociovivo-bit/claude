import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { isDeviceOnline } from "@/lib/mobile/thread-failover";
import { snapshotInfo } from "@/lib/mobile/station-relay";

export const dynamic = "force-dynamic";

/** Móviles de la estación vistos desde cualquier ordenador: conectados, ocupados y última imagen. */
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const { phones, canManage } = await loadMobileAutomationAccess(api.workspaceId, api.userId);
  const now = Date.now();
  const devices = phones.filter((phone) => phone.active && phone.deviceSerial).map((phone) => {
    const snapshot = snapshotInfo(api.workspaceId, phone.deviceSerial!);
    const live = Boolean(snapshot && now - snapshot.at <= 60_000);
    return {
      key: phone.key, label: phone.label, phone: phone.phone, deviceSerial: phone.deviceSerial,
      online: isDeviceOnline(api.workspaceId, phone.deviceSerial!, now) || live,
      live, snapshotAt: snapshot?.at ?? null, width: snapshot?.width ?? null, height: snapshot?.height ?? null,
      working: snapshot?.working ?? null
    };
  });
  return NextResponse.json({ ok: true, canManage, devices });
});
