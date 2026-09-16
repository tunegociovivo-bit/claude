import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/auth";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import type { MobileFacebookAccount, MobileFacebookAccountRequest } from "./facebook-accounts";

export type StoredMobileFacebookAccount = {
  id: string;
  name: string;
  usernameCipher: string;
  usernameKey: string;
  passwordCipher: string | null;
  savedOnDevice: boolean;
  active: boolean;
  version: number;
  updatedAt: string;
  lastMutationId: string;
};
export type MobileFacebookAccountStore = Record<string, StoredMobileFacebookAccount[]>;

export function accountsForDevice(store: MobileFacebookAccountStore, serial: string): StoredMobileFacebookAccount[] {
  return Object.prototype.hasOwnProperty.call(store, serial) && Array.isArray(store[serial]) ? store[serial]! : [];
}

export function accountForDisplay(account: StoredMobileFacebookAccount): MobileFacebookAccount {
  const username = decryptSecret(account.usernameCipher);
  if (username === null) throw new ApiError(409, "account_credentials_unavailable", "No se pueden leer los datos cifrados de las cuentas. Revisa la configuración de cifrado del Hub.");
  return {
    id: account.id, name: account.name, username,
    hasPassword: Boolean(account.passwordCipher), active: account.active,
    savedOnDevice: account.savedOnDevice, version: account.version, updatedAt: account.updatedAt
  };
}

export function updateMobileFacebookAccounts(
  store: MobileFacebookAccountStore,
  input: Exclude<MobileFacebookAccountRequest, { action: "list" }>,
  now = new Date().toISOString()
): MobileFacebookAccountStore {
  const accounts = accountsForDevice(store, input.deviceSerial);
  const existing = accounts.find(account => account.id === input.id);
  if (existing?.lastMutationId === input.mutationId) return store;
  if (input.version !== (existing?.version ?? 0)) {
    throw new ApiError(409, "account_changed", "La cuenta cambió en otra pestaña. Actualiza la lista antes de guardar.");
  }
  let updated: StoredMobileFacebookAccount;
  if (input.action === "setActive") {
    if (!existing) throw new ApiError(404, "account_not_found", "La cuenta no está asociada a este móvil.");
    updated = { ...existing, active: input.active, version: existing.version + 1, updatedAt: now, lastMutationId: input.mutationId };
  } else {
    if (!existing && accounts.length >= 20) throw new ApiError(409, "account_limit", "Puedes guardar hasta 20 cuentas por teléfono.");
    const usernameKey = createHash("sha256").update(input.username.toLowerCase()).digest("hex");
    if (accounts.some(account => account.id !== input.id && account.usernameKey === usernameKey)) {
      throw new ApiError(409, "duplicate_account", "Ese usuario ya está guardado en este teléfono. Puedes editar o reactivar su cuenta.");
    }
    if (existing?.passwordCipher && existing.usernameKey !== usernameKey && !input.password) {
      throw new ApiError(400, "password_required", "Al cambiar el usuario, introduce también la contraseña de esa cuenta.");
    }
    const passwordCipher = input.password ? encryptSecret(input.password) : existing?.passwordCipher ?? null;
    if (!passwordCipher && !input.savedOnDevice) {
      throw new ApiError(400, "password_required", "Introduce la contraseña o indica que la cuenta ya está guardada en Facebook en este móvil.");
    }
    updated = {
      id: input.id, name: input.name, usernameKey,
      usernameCipher: encryptSecret(input.username), passwordCipher,
      active: existing?.active ?? true, savedOnDevice: input.savedOnDevice,
      version: (existing?.version ?? 0) + 1, updatedAt: now, lastMutationId: input.mutationId
    };
  }
  return { ...store, [input.deviceSerial]: existing ? accounts.map(account => account.id === input.id ? updated : account) : [...accounts, updated] };
}
