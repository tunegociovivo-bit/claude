import "server-only";
import type { Frame, Locator, Page } from "playwright-core";

// Inicio de sesión genérico en un portal: rechaza cookies, encuentra usuario y
// contraseña (también en formularios de dos pasos: usuario → «Siguiente» →
// contraseña), envía y clasifica el resultado. Un solo intento por revisión:
// si las credenciales fallan, el portal se marca y no se reintenta hasta que
// alguien las cambie (para no bloquear la cuenta del cliente).

export type LoginOutcome =
  | { status: "ok" }
  | { status: "login_failed"; detail: string }
  | { status: "attention"; detail: string } // captcha, 2FA, aceptar condiciones…
  | { status: "blocked"; detail: string } // el portal no deja entrar al robot
  | { status: "error"; detail: string };

export class RadarLoginError extends Error {
  constructor(public outcome: Exclude<LoginOutcome, { status: "ok" }>) {
    super(outcome.detail);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REJECT_SELECTORS = [
  "#onetrust-reject-all-handler",
  "button#didomi-notice-disagree-button",
  "#CybotCookiebotDialogBodyButtonDecline",
  "button[data-testid='uc-deny-all-button']",
  ".cmplz-deny",
];
const ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "button#didomi-notice-agree-button",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "button[data-testid='uc-accept-all-button']",
];
const COOKIE_TEXT_REJECT = /^(rechazar( todo| todas)?|solo (las )?necesarias|reject( all)?|decline|refuser( tout)?|tout refuser|alle ablehnen|ablehnen|nur notwendige|continuar sin aceptar|only necessary)$/i;
const COOKIE_TEXT_ACCEPT = /^(aceptar( todo| todas| cookies)?|accept( all)?( cookies)?|agree|i agree|accepter( tout)?|tout accepter|alle akzeptieren|akzeptieren|permitir todas|allow all|ok|entendido|de acuerdo)$/i;

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
      await loc.click({ timeout: 3_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

/** Quita el aviso de cookies (primero «rechazar», si no hay, «aceptar» para poder seguir). */
export async function dismissCookies(page: Page): Promise<void> {
  if (await clickFirstVisible(page, REJECT_SELECTORS)) return;
  const buttons = page.locator("button, a[role=button], [role=button]");
  const count = Math.min(await buttons.count().catch(() => 0), 60);
  let accept: Locator | null = null;
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    const text = ((await b.innerText({ timeout: 300 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 40) continue;
    if (COOKIE_TEXT_REJECT.test(text) && (await b.isVisible().catch(() => false))) {
      await b.click({ timeout: 3_000 }).catch(() => undefined);
      return;
    }
    if (!accept && COOKIE_TEXT_ACCEPT.test(text) && (await b.isVisible().catch(() => false))) accept = b;
  }
  if (await clickFirstVisible(page, ACCEPT_SELECTORS)) return;
  if (accept) await accept.click({ timeout: 3_000 }).catch(() => undefined);
}

const USER_SELECTORS = [
  "input[autocomplete='username']",
  "input[type='email']",
  "input[name='username' i]",
  "input[name='userName' i]",
  "input[name='login' i]",
  "input[name='email' i]",
  "input[name='user' i]",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[id*='login' i]",
  "input[name*='mail' i]",
  "input[id*='mail' i]",
  "input[formcontrolname*='user' i]",
  "input[placeholder*='usuario' i]",
  "input[placeholder*='user' i]",
  "input[placeholder*='mail' i]",
];
const PASSWORD_SELECTOR = "input[type='password']";
const OTP_SELECTORS = [
  "input[autocomplete='one-time-code']",
  "input[name*='otp' i]",
  "input[name*='totp' i]",
  "input[name*='verificationcode' i]",
  "input[id*='otp' i]",
];
const CAPTCHA_SELECTORS = [
  "iframe[src*='recaptcha/api2/bframe']",
  "iframe[src*='hcaptcha.com'][src*='challenge']",
  "iframe[src*='challenges.cloudflare.com']",
  "iframe[src*='recaptcha/api2/anchor'][width='304']",
  "iframe[src*='hcaptcha.com'][src*='checkbox']",
  "#challenge-running",
  "#cf-challenge-running",
];

/** Todos los marcos de la página (algunos portales meten el login en un iframe). */
function frames(page: Page): Frame[] {
  return [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function firstVisible(frame: Frame, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = frame.locator(sel);
    const n = Math.min(await loc.count().catch(() => 0), 5);
    for (let i = 0; i < n; i++) {
      const item = loc.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function findLoginFields(page: Page): Promise<{ frame: Frame; user: Locator | null; password: Locator | null } | null> {
  for (const frame of frames(page)) {
    const password = await firstVisible(frame, [PASSWORD_SELECTOR]);
    const user = await firstVisible(frame, USER_SELECTORS);
    if (password || user) {
      // Sin selector claro de usuario, el texto visible anterior a la contraseña.
      if (password && !user) {
        const texts = frame.locator("input[type='text'], input:not([type])");
        const n = Math.min(await texts.count().catch(() => 0), 6);
        for (let i = 0; i < n; i++) {
          if (await texts.nth(i).isVisible().catch(() => false)) return { frame, user: texts.nth(i), password };
        }
      }
      return { frame, user, password };
    }
  }
  return null;
}

const LOGIN_LINK = /^(iniciar sesi[oó]n|acceder|accede|acceso|entrar|login|log in|sign in|connexion|se connecter|anmelden|mi cuenta|acceso clientes|área de clientes|area clientes|identif[ií]cate)$/i;
const NEXT_BUTTON = /^(siguiente|continuar|next|continue|weiter|suivant|valider)$/i;
const SUBMIT_BUTTON = /^(iniciar sesi[oó]n|acceder|accede|entrar|login|log in|sign in|connexion|se connecter|anmelden|enviar|submit|ok|continuar|continue|valider|weiter)$/i;

async function clickByText(frame: Frame, re: RegExp, scope = "button, input[type=submit], a, [role=button]"): Promise<boolean> {
  const loc = frame.locator(scope);
  const n = Math.min(await loc.count().catch(() => 0), 80);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const text = ((await el.innerText({ timeout: 300 }).catch(() => "")) || (await el.getAttribute("value").catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text && text.length <= 40 && re.test(text) && (await el.isVisible().catch(() => false))) {
      await el.click({ timeout: 5_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function submit(frame: Frame, field: Locator) {
  const form = field.locator("xpath=ancestor::form[1]");
  if ((await form.count().catch(() => 0)) > 0) {
    const btn = form.locator("button[type=submit], input[type=submit], button:not([type])").first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }
  if (await clickByText(frame, SUBMIT_BUTTON)) return;
  await field.press("Enter").catch(() => undefined);
}

async function settle(page: Page, ms = 2_500) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: ms * 4 }).catch(() => undefined);
  await sleep(ms);
}

async function typeLikeHuman(field: Locator, value: string) {
  await field.click({ timeout: 5_000 }).catch(() => undefined);
  await field.fill("").catch(() => undefined);
  await field.pressSequentially(value, { delay: 35 + Math.floor(Math.random() * 40) }).catch(async () => {
    await field.fill(value);
  });
}

const ERROR_TEXT = /(contrase[ñn]a|usuario|credenciales|password|username|login|identifiants|mot de passe|kennwort|benutzer)[^.]{0,80}(incorrect|inv[aá]lid|err[oó]ne|wrong|no v[aá]lid|no coincide|falsch|not recognized|no reconoc)|(incorrect|invalid|wrong|inv[aá]lid)[^.]{0,40}(password|contrase|credential|credencial|usuario|username|login)|cuenta (bloqueada|deshabilitada)|account (locked|disabled|blocked)/i;
const BLOCKED_TEXT = /(access denied|acceso denegado|request blocked|you have been blocked|unusual traffic|tr[aá]fico inusual|pardon our interruption|are you a robot|verify you are human|verifica que eres humano|just a moment)/i;

export async function detectBlockers(page: Page): Promise<LoginOutcome | null> {
  const text = ((await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "")) || "").slice(0, 20_000);
  for (const frame of frames(page)) {
    if (await firstVisible(frame, CAPTCHA_SELECTORS)) {
      return { status: "attention", detail: "El portal pide un captcha («no soy un robot»). Hay que entrar una vez a mano desde el CRM." };
    }
    if (await firstVisible(frame, OTP_SELECTORS)) {
      return { status: "attention", detail: "El portal pide un código de verificación (doble factor). Hay que entrar una vez a mano." };
    }
  }
  if (BLOCKED_TEXT.test(text)) return { status: "blocked", detail: "El portal ha bloqueado el acceso automático (protección anti-robots)." };
  if (/(c[oó]digo de verificaci[oó]n|verification code|two.factor|doble factor|2fa|code de v[ée]rification|best[äa]tigungscode)/i.test(text)) {
    return { status: "attention", detail: "El portal pide un código de verificación (doble factor). Hay que entrar una vez a mano." };
  }
  return null;
}

/**
 * Inicia sesión. `isLoggedIn` es la comprobación del portal (cookie, menú de
 * usuario, URL…). Devuelve el resultado; nunca reintenta la contraseña.
 */
export async function genericLogin(
  page: Page,
  opts: { loginUrl: string; username: string; password: string; isLoggedIn: (page: Page) => Promise<boolean>; beforeFill?: (page: Page) => Promise<void> }
): Promise<LoginOutcome> {
  try {
    await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    return { status: "error", detail: `No se pudo abrir la página de acceso (${(error as Error).message.split("\n")[0].slice(0, 120)})` };
  }
  await settle(page, 1_500);
  await dismissCookies(page);
  if (await opts.isLoggedIn(page)) return { status: "ok" };
  const early = await detectBlockers(page);
  if (early && early.status === "blocked") return early;
  if (opts.beforeFill) await opts.beforeFill(page);

  let fields = await findLoginFields(page);
  if (!fields) {
    // Página de inicio con botón «Iniciar sesión».
    for (const frame of frames(page)) {
      if (await clickByText(frame, LOGIN_LINK)) break;
    }
    await settle(page, 2_000);
    await dismissCookies(page);
    fields = await findLoginFields(page);
  }
  if (!fields) {
    const blocker = await detectBlockers(page);
    return blocker ?? { status: "error", detail: "No se encontró el formulario de acceso del portal (puede haber cambiado la web)." };
  }

  // Paso 1: usuario (y contraseña si está en la misma pantalla).
  if (fields.user) await typeLikeHuman(fields.user, opts.username);
  if (!fields.password) {
    if (!(await clickByText(fields.frame, NEXT_BUTTON))) await fields.user?.press("Enter").catch(() => undefined);
    await settle(page, 2_000);
    const second = await findLoginFields(page);
    if (!second?.password) {
      const blocker = await detectBlockers(page);
      return blocker ?? { status: "error", detail: "Tras el usuario no apareció la contraseña (¿usuario no reconocido?)." };
    }
    fields = second;
  }
  await typeLikeHuman(fields.password!, opts.password);
  await sleep(400 + Math.floor(Math.random() * 600));
  await submit(fields.frame, fields.password!);
  await settle(page, 3_000);

  // Resultado.
  for (let i = 0; i < 6; i++) {
    if (await opts.isLoggedIn(page)) return { status: "ok" };
    const blocker = await detectBlockers(page);
    if (blocker) return blocker;
    const bodyText = ((await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")) || "").slice(0, 20_000);
    const stillForm = await findLoginFields(page);
    if (stillForm?.password && ERROR_TEXT.test(bodyText)) {
      return { status: "login_failed", detail: "El portal dice que el usuario o la contraseña no son correctos." };
    }
    await sleep(2_500);
  }
  const stillForm = await findLoginFields(page);
  if (stillForm?.password) {
    return { status: "login_failed", detail: "El portal no aceptó el acceso (sigue pidiendo la contraseña). Revisa usuario y contraseña." };
  }
  return { status: "error", detail: "No se pudo confirmar que la sesión esté iniciada." };
}
