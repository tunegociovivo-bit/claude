import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess, requireSerialLinkedToWorkspace } from "@/lib/mobile/automation-access";
import { sharedPhonesFromLeads } from "@/lib/mobile/shared-phones";
import { mobileFacebookAccountRequestSchema } from "@/lib/mobile/facebook-accounts";
import { accountsForDevice, accountForDisplay, updateMobileFacebookAccounts, type MobileFacebookAccountStore } from "@/lib/mobile/facebook-accounts-server";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { workspace, phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = mobileFacebookAccountRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Datos de cuenta no válidos.");
  const input = parsed.data;
  requireSerialLinkedToWorkspace(phones, input.deviceSerial);
  const initial = (workspace.settings ?? {}) as Record<string, unknown>;
  const readStore = (settings: Record<string, unknown>) => (settings.mobileFacebookAccounts ?? {}) as MobileFacebookAccountStore;
  if (input.action === "list") {
    return NextResponse.json({ accounts: accountsForDevice(readStore(initial), input.deviceSerial).map(accountForDisplay) });
  }
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      const fresh = await tx.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
      if (!fresh) throw new ApiError(404, "workspace_missing", "El espacio ya no existe.");
      const settings = (fresh.settings ?? {}) as Record<string, unknown>;
      requireSerialLinkedToWorkspace(sharedPhonesFromLeads(settings.leads), input.deviceSerial);
      const store = updateMobileFacebookAccounts(readStore(settings), input);
      await tx.workspace.update({
        where: { id: api.workspaceId },
        data: { settings: { ...settings, mobileFacebookAccounts: store } as Prisma.InputJsonObject }
      });
      return accountsForDevice(store, input.deviceSerial).map(accountForDisplay);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Never forward database or encryption errors that could include request data.
    throw new ApiError(409, "account_save_failed", "No se pudo guardar la cuenta. Actualiza la lista y vuelve a intentarlo.");
  }
  return NextResponse.json({ accounts: result });
});
