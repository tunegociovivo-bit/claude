import { normalizeAndroidProxy } from "@/lib/mobile/android-proxy";

export const PRINCIPAL_PHONE_KEY = "__principal__";

export type SharedAndroidProxy = {
  host: string;
  port: number;
  requiresIpAuthorization: boolean;
  source: "global" | "number";
};

export type SharedMobilePhone = {
  key: string;
  sessionName: string;
  label: string;
  phone: string;
  deviceSerial: string | null;
  active: boolean;
  principal: boolean;
  proxyConfigured: boolean;
  androidProxy: SharedAndroidProxy | null;
};

function androidProxyFromUrl(raw: unknown, source: SharedAndroidProxy["source"]): SharedAndroidProxy | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const proxy = normalizeAndroidProxy(url.hostname, url.port);
    return {
      ...proxy,
      requiresIpAuthorization: Boolean(url.username || url.password),
      source
    };
  } catch {
    return null;
  }
}

export function sanitizeMobileSessionName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizedPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function sharedPhonesFromLeads(leads: any): SharedMobilePhone[] {
  const principalSession = String(leads?.wahaSession ?? "default");
  const globalProxyRaw = leads?.wahaProxy ?? leads?.proxyUrl ?? null;
  const globalAndroidProxy = androidProxyFromUrl(globalProxyRaw, "global");
  const principal: SharedMobilePhone = {
    key: PRINCIPAL_PHONE_KEY,
    sessionName: principalSession,
    label: "Principal",
    phone: String(leads?.principalPhone ?? ""),
    deviceSerial: typeof leads?.principalDeviceSerial === "string" && leads.principalDeviceSerial
      ? leads.principalDeviceSerial
      : null,
    active: true,
    principal: true,
    proxyConfigured: Boolean(String(globalProxyRaw ?? "").trim()),
    androidProxy: globalAndroidProxy
  };

  const channels = Array.isArray(leads?.channels) ? leads.channels : [];
  return [
    principal,
    ...channels
      .filter((channel: any) => typeof channel?.name === "string" && channel.name.trim())
      .map((channel: any): SharedMobilePhone => {
        const numberProxyRaw = channel.proxy;
        const numberAndroidProxy = androidProxyFromUrl(numberProxyRaw, "number");
        return {
          key: channel.name,
          sessionName: channel.name,
          label: String(channel.label || channel.name),
          phone: String(channel.phone ?? ""),
          deviceSerial: typeof channel.deviceSerial === "string" && channel.deviceSerial
            ? channel.deviceSerial
            : null,
          active: channel.active !== false,
          principal: false,
          proxyConfigured: Boolean(String(numberProxyRaw ?? globalProxyRaw ?? "").trim()),
          androidProxy: numberAndroidProxy ?? globalAndroidProxy
        };
      })
  ];
}
