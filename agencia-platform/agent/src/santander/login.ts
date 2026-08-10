export type LoginAction = "SUBMIT_SAVED_KEY" | "PAUSE";

export interface LoginFacts {
  currentUrl: string;
  allowedOrigin: string;
  visibleKeyFields: number;
  rememberedUser: boolean;
  hasStoredCredential: boolean;
}

export function validateAccessKey(value: string): string {
  if (value.length !== 8 || /\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("La clave local de Santander debe contener exactamente ocho caracteres válidos.");
  }
  return value;
}

export function decideLoginAction(facts: LoginFacts): LoginAction {
  try {
    const current = new URL(facts.currentUrl);
    const allowed = new URL(facts.allowedOrigin);
    const officialLogin = current.protocol === "https:"
      && allowed.protocol === "https:"
      && current.origin === allowed.origin
      && current.pathname.startsWith("/paas/loginnwe/");
    return officialLogin && facts.visibleKeyFields === 8 && facts.rememberedUser && facts.hasStoredCredential
      ? "SUBMIT_SAVED_KEY" : "PAUSE";
  } catch { return "PAUSE"; }
}

export function isAuthenticatedSantanderUrl(currentUrl: string, allowedOrigin: string): boolean {
  try {
    const current = new URL(currentUrl);
    const allowed = new URL(allowedOrigin);
    return current.protocol === "https:"
      && allowed.protocol === "https:"
      && current.origin === allowed.origin
      && current.pathname.startsWith("/paas/nwe/app/");
  } catch {
    return false;
  }
}

export function shouldAttemptSavedLogin(sessionReadyVisible: boolean): boolean {
  return !sessionReadyVisible;
}

export function numericPageLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim()).filter((label) => /^\d{1,3}$/.test(label)))]
    .map(Number)
    .filter((page) => page >= 1 && page <= 100)
    .sort((a, b) => a - b)
    .map(String);
}

export function isSafePaginationControl(role: string, label: string): boolean {
  return (role === "link" || role === "button") && /^\d{1,3}$/.test(label.trim()) && Number(label.trim()) >= 1 && Number(label.trim()) <= 100;
}

export function isRemittanceGeneratorUrl(currentUrl: string, allowedOrigin: string): boolean {
  try {
    const current = new URL(currentUrl);
    const allowed = new URL(allowedOrigin);
    return current.protocol === "https:"
      && current.origin === allowed.origin
      && current.pathname.startsWith("/paas/genweb/")
      && current.hash.includes("/generator/charges/debtsSEPA/");
  } catch { return false; }
}

export function buildRemittanceGeneratorUrl(allowedOrigin: string): string {
  const allowed = new URL(allowedOrigin);
  if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.search || allowed.hash || (allowed.pathname !== "/" && allowed.pathname !== "")) {
    throw new Error("El origen oficial de Santander no es válido para abrir el generador.");
  }
  return `${allowed.origin}/paas/genweb/nwe-gw-19-ui/#!/generator/charges/debtsSEPA/all`;
}

export function formatSantanderAmount(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Importe autorizado inválido.");
  return (amountCents / 100).toFixed(2).replace(".", ",");
}

export function parseDisplayedAmountCents(shown: string): number | null {
  const token = shown.replace(/\s/g, "").match(/\d[\d.,]*/)?.[0];
  if (!token) return null;
  const normalized = token.includes(",") ? token.replace(/\./g, "").replace(",", ".") : token;
  const value = Math.round(Number(normalized) * 100);
  return Number.isFinite(value) ? value : null;
}

export function isSafeReconnectLabel(label: string): boolean {
  return label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "volver a conectar";
}

export function shouldWaitForAmountConfirmation(currentCents: number | null, expectedCents: number, attempt: number, maxAttempts: number): boolean {
  return currentCents !== expectedCents && attempt < maxAttempts;
}

export function isEnvioremFrameUrl(currentUrl: string, allowedOrigin: string): boolean {
  try {
    const current = new URL(currentUrl);
    const allowed = new URL(allowedOrigin);
    return current.protocol === "https:" && current.origin === allowed.origin && current.pathname.startsWith("/paas/enviorem/");
  } catch { return false; }
}

export function shouldWaitForRemittanceList(templateVisible: boolean, pageLabels: string[], attempt: number, maxAttempts: number): boolean {
  return !templateVisible && pageLabels.length === 0 && attempt < maxAttempts;
}

export function uniqueVisibleIndex(visibility: boolean[]): number | null {
  const indexes = visibility.map((visible, index) => visible ? index : -1).filter((index) => index >= 0);
  return indexes.length === 1 ? indexes[0] : null;
}

export function isSafeBasicPaymentsLabel(label: string): boolean {
  return label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "pagos y cobros basicos";
}

export function canContinueToDirectDebit(categoryOpened: boolean, uniqueDirectDebitVisible: boolean): boolean {
  return categoryOpened || uniqueDirectDebitVisible;
}

export function isSafeRemittanceGenerationLabel(label: string): boolean {
  const normalized = label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  return normalized === "generacion" || normalized === "generacion de remesas";
}
