import { ADB_DEFAULT_AUTHENTICATORS, AdbAuthType, type AdbAuthenticator } from "@yume-chan/adb";

// A signature challenge is routine and normally uses an already trusted key.
// Only sending the public key asks Android to display its approval dialog.
export function observeMobileAuthorization(onApprovalRequested: () => void): readonly AdbAuthenticator[] {
  return ADB_DEFAULT_AUTHENTICATORS.map(authenticator => async function* (store, next) {
    for await (const packet of authenticator(store, next)) {
      if (packet.arg0 === AdbAuthType.PublicKey) onApprovalRequested();
      yield packet;
    }
  });
}

export function waitForMobileAuthentication<T extends { close: () => unknown }>(
  pending: Promise<T>,
  options: { signal: AbortSignal; timeoutMs?: number; approvalRequested: () => boolean }
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new DOMException("Conexión cancelada", "AbortError"));
    const timer = setTimeout(() => finish(new Error(options.approvalRequested()
      ? "Android no ha confirmado la autorización USB. Si ya la aceptaste, pulsa Reintentar para comprobar de nuevo la conexión con la clave guardada."
      : "El móvil no ha completado la conexión USB. No se ha recibido una petición de autorización. Pulsa Reintentar; se conservará la clave guardada.")), options.timeoutMs ?? 60_000);
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    pending.then(value => {
      if (settled) { void Promise.resolve().then(() => value.close()).catch(() => undefined); return; }
      finish(undefined, value);
    }, error => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
