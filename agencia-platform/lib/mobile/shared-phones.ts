export const PRINCIPAL_PHONE_KEY = "__principal__";

export type SharedMobilePhone = {
  key: string;
  sessionName: string;
  label: string;
  phone: string;
  deviceSerial: string | null;
  active: boolean;
  principal: boolean;
  proxyConfigured: boolean;
};

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
    proxyConfigured: Boolean(String(leads?.wahaProxy ?? "").trim())
  };

  const channels = Array.isArray(leads?.channels) ? leads.channels : [];
  return [
    principal,
    ...channels
      .filter((channel: any) => typeof channel?.name === "string" && channel.name.trim())
      .map((channel: any): SharedMobilePhone => ({
        key: channel.name,
        sessionName: channel.name,
        label: String(channel.label || channel.name),
        phone: String(channel.phone ?? ""),
        deviceSerial: typeof channel.deviceSerial === "string" && channel.deviceSerial
          ? channel.deviceSerial
          : null,
        active: channel.active !== false,
        principal: false,
        proxyConfigured: Boolean(String(channel.proxy ?? "").trim())
      }))
  ];
}
