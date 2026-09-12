import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { userCanAccessPlatform } from "@/lib/platforms-server";
import { sharedPhonesFromLeads, type SharedMobilePhone } from "@/lib/mobile/shared-phones";

export async function loadMobileAutomationAccess(
  workspaceId: string,
  userId: string | undefined,
  options: { manager?: boolean } = {}
) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  if (!(await userCanAccessPlatform(workspaceId, userId, "mobile_farm"))) {
    throw new ApiError(403, "forbidden", "No tienes acceso a F - Móviles");
  }
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    prisma.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } })
  ]);
  if (!workspace || !membership) {
    throw new ApiError(403, "forbidden", "No perteneces a este workspace");
  }
  const canManage = membership.role === "ADMIN";
  if (options.manager && !canManage) {
    throw new ApiError(403, "forbidden", "Solo los administradores pueden aprobar automatizaciones");
  }
  const leads = (workspace.settings as any)?.leads ?? {};
  return { workspace, canManage, phones: sharedPhonesFromLeads(leads) };
}

export function requireLinkedMobile(
  phones: readonly SharedMobilePhone[],
  phoneKey: string,
  deviceSerial: string
): SharedMobilePhone {
  const phone = phones.find((item) => item.key === phoneKey);
  if (!phone) throw new ApiError(404, "phone_not_found", "El teléfono compartido ya no existe");
  if (!phone.deviceSerial || phone.deviceSerial !== deviceSerial) {
    throw new ApiError(
      409,
      "device_not_linked",
      "El Android ya no está asociado a ese teléfono compartido"
    );
  }
  if (!phone.active) throw new ApiError(409, "phone_inactive", "El teléfono compartido está inactivo");
  return phone;
}

export function requireSerialLinkedToWorkspace(
  phones: readonly SharedMobilePhone[],
  deviceSerial: string
): SharedMobilePhone {
  const phone = phones.find((item) => item.active && item.deviceSerial === deviceSerial);
  if (!phone) {
    throw new ApiError(409, "device_not_linked", "Asocia este Android a un número antes de ejecutar trabajos");
  }
  return phone;
}

