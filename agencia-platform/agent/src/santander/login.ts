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
