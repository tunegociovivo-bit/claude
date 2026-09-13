export type AndroidHttpProxy = {
  host: string;
  port: number;
};

export type AndroidProxySyncState =
  | "unmanaged"
  | "synced"
  | "needs-apply"
  | "needs-ip-authorization";

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isValidIpv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > 253 || host.includes("..")) return false;
  if (/^\d+(?:\.\d+){3}$/.test(host)) return isValidIpv4(host);
  return host.split(".").every((label) => DOMAIN_LABEL.test(label));
}

export function normalizeAndroidProxy(hostInput: string, portInput: string | number): AndroidHttpProxy {
  const host = hostInput.trim().toLowerCase();
  const port = typeof portInput === "number" ? portInput : Number(portInput.trim());

  if (!isValidHostname(host)) {
    throw new Error("Introduce solo el host o la IP del proxy, sin http://, usuario, contraseña ni ruta.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("El puerto del proxy debe estar entre 1 y 65535.");
  }

  return { host, port };
}

export function parseAndroidProxy(raw: string | null | undefined): AndroidHttpProxy | null {
  const value = String(raw ?? "").trim();
  if (!value || value === "null" || value === ":0" || value === "0.0.0.0:0") return null;

  const separator = value.lastIndexOf(":");
  if (separator <= 0) return null;
  try {
    return normalizeAndroidProxy(value.slice(0, separator), value.slice(separator + 1));
  } catch {
    return null;
  }
}

export function formatAndroidProxy(proxy: AndroidHttpProxy): string {
  return `${proxy.host}:${proxy.port}`;
}

export function getAndroidProxySyncState(
  configured: (AndroidHttpProxy & { requiresIpAuthorization: boolean }) | null,
  applied: AndroidHttpProxy | null
): AndroidProxySyncState {
  if (!configured) return "unmanaged";
  if (applied && formatAndroidProxy(configured) === formatAndroidProxy(applied)) return "synced";
  return configured.requiresIpAuthorization ? "needs-ip-authorization" : "needs-apply";
}
