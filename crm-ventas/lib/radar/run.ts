import "server-only";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { prisma } from "@/lib/prisma";
import { openBrowser, newRadarContext, closeQuietly, radarBrowserConfigured, RadarBrowserUnavailableError } from "./browser";
import { genericLogin, type LoginOutcome } from "./login";
import { collectVehicles, type CollectDebug } from "./collect";
import { getPortal, jsonUrlFilterFor, urlBelongsToPortal, type PortalDef } from "./portals";
import { upsertListing, deactivateStale, saveSession, loadSession, sourceCredentials } from "./store";
import { evaluateMatches, type NewMatch } from "./match";
import { notifyNewMatches } from "./notify";
import { notifyWorkspaceUrgentAlert } from "@/lib/urgent-alert-delivery";

// Orquesta una revisión: por cada portal activo del negocio abre un navegador,
// inicia sesión (o reutiliza la sesión guardada), recoge los coches, los guarda,
// cruza las búsquedas y avisa. Un portal que falle no tumba a los demás.

const PER_PORTAL_BUDGET_MS = 3 * 60_000;
const MAX_VEHICLES_PER_PORTAL = 400;
const RUN_LEASE_MS = 20 * 60_000;

export type PortalSummary = {
  portal: string;
  status: "ok" | "login_failed" | "attention" | "blocked" | "error" | "skipped";
  found: number;
  newCount: number;
  detail?: string;
  // Diagnóstico (se guarda en el summary del run para afinar cada portal):
  // dónde aterrizó el login, páginas de listado visitadas y endpoints JSON vistos.
  debug?: {
    postLoginUrl?: string;
    snippet?: string;
    endpoints?: { url: string; bytes: number | null }[];
    pages?: { requested: string; finalUrl: string; title: string }[];
  };
};

async function isLoggedInFor(portal: PortalDef, page: Page): Promise<boolean> {
  const li = portal.loggedIn;
  const url = page.url().toLowerCase();
  if (li.urlIncludes?.some((u) => url.includes(u.toLowerCase()))) return true;
  for (const sel of li.selectors ?? []) {
    if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
  }
  if (li.textIncludes?.length) {
    const body = ((await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")) || "").toLowerCase();
    if (li.textIncludes.some((t) => body.includes(t.toLowerCase()))) return true;
  }
  return false;
}

type SourceRow = {
  id: string; portal: string; enabled: boolean;
  usernameEnc: string | null; passwordEnc: string | null; consecutiveFailures: number;
};

async function runOnePortal(opts: {
  workspaceId: string;
  source: SourceRow;
  browser: Browser;
  allowAi: boolean;
  deadline: number;
}): Promise<{ summary: PortalSummary; newListingIds: string[] }> {
  const { workspaceId, source } = opts;
  const portal = getPortal(source.portal);
  if (!portal) return { summary: { portal: source.portal, status: "error", found: 0, newCount: 0, detail: "Portal desconocido" }, newListingIds: [] };

  const creds = sourceCredentials(source);
  if (!creds) {
    await prisma.radarSource.update({ where: { id: source.id }, data: { status: "pending", statusDetail: "Faltan usuario o contraseña", lastRunAt: new Date() } });
    return { summary: { portal: portal.key, status: "skipped", found: 0, newCount: 0, detail: "Sin credenciales" }, newListingIds: [] };
  }

  let context: BrowserContext | null = null;
  const log = (msg: string) => console.log(`[radar][${workspaceId}][${portal.key}] ${msg}`);
  try {
    const savedSession = await loadSession(source.id);
    context = await newRadarContext(opts.browser, savedSession ?? undefined);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);

    const debug: CollectDebug = { endpoints: [], pages: [] };

    // Con sesión guardada, probar directamente la lista; si no hay sesión, iniciarla.
    let outcome: LoginOutcome = { status: "ok" };
    let loggedIn = false;
    if (savedSession) {
      await page.goto(portal.listingUrls[0], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      loggedIn = await isLoggedInFor(portal, page).catch(() => false);
    }
    if (!loggedIn) {
      outcome = await genericLogin(page, {
        loginUrl: portal.loginUrl,
        username: creds.username,
        password: creds.password,
        isLoggedIn: (p) => isLoggedInFor(portal, p),
      });
      loggedIn = outcome.status === "ok";
    }

    if (!loggedIn) {
      const status = outcome.status === "ok" ? "error" : outcome.status;
      const detail = outcome.status === "ok" ? "No se pudo confirmar la sesión" : outcome.detail;
      // Diagnóstico: a dónde aterrizó el intento y qué se ve, para afinar el
      // detector de sesión o descubrir un login en varios pasos.
      const snippet = ((await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 400);
      await prisma.radarSource.update({
        where: { id: source.id },
        data: { status, statusDetail: detail.slice(0, 500), lastRunAt: new Date(), consecutiveFailures: { increment: 1 } },
      });
      return { summary: { portal: portal.key, status, found: 0, newCount: 0, detail, debug: { postLoginUrl: page.url(), snippet, endpoints: debug.endpoints, pages: debug.pages } }, newListingIds: [] };
    }

    // Sesión buena: guardarla para la próxima vez.
    await saveSession(source.id, await context.storageState());

    const vehicles = await collectVehicles(page, {
      workspaceId,
      listingUrls: portal.listingUrls,
      deadline: Math.min(opts.deadline, Date.now() + PER_PORTAL_BUDGET_MS),
      maxVehicles: MAX_VEHICLES_PER_PORTAL,
      map: {
        baseUrl: portal.listingUrls[0],
        defaultCountry: portal.defaultCountry ?? null,
      },
      jsonUrlFilter: jsonUrlFilterFor(portal),
      allowAi: opts.allowAi,
      log,
      debug,
    });

    const seenStart = new Date();
    const newListingIds: string[] = [];
    let newCount = 0;
    for (const v of vehicles) {
      // Descarta enlaces que no sean del propio portal.
      if (v.url && !urlBelongsToPortal(portal, v.url)) v.url = null;
      const r = await upsertListing({ workspaceId, sourceId: source.id, portal: portal.key, vehicle: v });
      if (r.isNew) {
        newCount++;
        newListingIds.push(r.listingId);
      }
    }
    if (vehicles.length > 0) await deactivateStale(workspaceId, portal.key, seenStart);

    await prisma.radarSource.update({
      where: { id: source.id },
      data: { status: "ok", statusDetail: null, lastRunAt: new Date(), lastOkAt: new Date(), lastCount: vehicles.length, consecutiveFailures: 0 },
    });
    return { summary: { portal: portal.key, status: "ok", found: vehicles.length, newCount, debug: { postLoginUrl: page.url(), endpoints: debug.endpoints, pages: debug.pages } }, newListingIds };
  } catch (error) {
    const detail = (error as Error).message?.split("\n")[0]?.slice(0, 300) ?? "Error";
    await prisma.radarSource.update({
      where: { id: source.id },
      data: { status: "error", statusDetail: detail, lastRunAt: new Date(), consecutiveFailures: { increment: 1 } },
    }).catch(() => undefined);
    return { summary: { portal: portal.key, status: "error", found: 0, newCount: 0, detail }, newListingIds: [] };
  } finally {
    await closeQuietly(context);
  }
}

/** Ejecuta un RadarRun (ya creado en estado queued). Toma su lease y lo libera al acabar. */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.radarRun.findUnique({ where: { id: runId } });
  if (!run) return;
  // Reclamo atómico: solo una instancia procesa este run.
  const claimed = await prisma.radarRun.updateMany({
    where: { id: runId, status: "queued" },
    data: { status: "running", startedAt: new Date(), leaseUntil: new Date(Date.now() + RUN_LEASE_MS) },
  });
  if (claimed.count !== 1) return;

  const workspaceId = run.workspaceId;
  const deadline = Date.now() + RUN_LEASE_MS - 60_000;
  const summaries: PortalSummary[] = [];
  const allNewIds: string[] = [];

  try {
    if (!radarBrowserConfigured()) throw new RadarBrowserUnavailableError();

    // Salvo en una prueba explícita de un portal («Probar acceso», trigger
    // "test"), NO se reintentan los portales cuyo acceso ha fallado o está
    // bloqueado/pendiente de intervención (login_failed/blocked/attention):
    // reintentar una contraseña incorrecta podría bloquear la cuenta real del
    // cliente. Al cambiar las credenciales, saveSourceCredentials deja el
    // estado en "pending" y vuelve a entrar en las revisiones. "error" sí se
    // reintenta (suele ser un fallo transitorio del portal o de la red).
    const isTest = run.trigger === "test";
    const sources = await prisma.radarSource.findMany({
      where: {
        workspaceId,
        enabled: true,
        ...(run.sourceId ? { id: run.sourceId } : {}),
        ...(isTest ? {} : { status: { notIn: ["login_failed", "blocked", "attention"] } }),
      },
      select: { id: true, portal: true, enabled: true, usernameEnc: true, passwordEnc: true, consecutiveFailures: true },
      orderBy: { portal: "asc" },
    });

    for (const source of sources) {
      if (Date.now() > deadline) {
        summaries.push({ portal: source.portal, status: "skipped", found: 0, newCount: 0, detail: "Sin tiempo en este pase" });
        continue;
      }
      // Un navegador nuevo por portal (aislamiento).
      let browser: Browser | null = null;
      try {
        browser = await openBrowser();
        const { summary, newListingIds } = await runOnePortal({ workspaceId, source, browser, allowAi: true, deadline });
        summaries.push(summary);
        allNewIds.push(...newListingIds);
      } catch (error) {
        summaries.push({ portal: source.portal, status: "error", found: 0, newCount: 0, detail: (error as Error).message?.slice(0, 200) });
      } finally {
        await closeQuietly(browser);
      }
      // Renueva el lease entre portales (pases largos).
      await prisma.radarRun.update({ where: { id: runId }, data: { leaseUntil: new Date(Date.now() + RUN_LEASE_MS) } }).catch(() => undefined);
    }

    // Cruce y avisos.
    let matches: NewMatch[] = [];
    if (allNewIds.length) matches = await evaluateMatches(workspaceId, allNewIds);
    let notified = 0;
    if (matches.length) notified = (await notifyNewMatches(workspaceId, matches)).notified;

    const found = summaries.reduce((a, s) => a + s.found, 0);
    const newCount = summaries.reduce((a, s) => a + s.newCount, 0);
    const anyOk = summaries.some((s) => s.status === "ok");
    const anyBad = summaries.some((s) => s.status !== "ok" && s.status !== "skipped");
    await prisma.radarRun.update({
      where: { id: runId },
      data: {
        status: anyOk && anyBad ? "partial" : anyOk || summaries.length === 0 ? "ok" : "error",
        finishedAt: new Date(),
        leaseUntil: null,
        found,
        newCount,
        matched: notified,
        summary: summaries as any,
      },
    });

    // Avisa a Negocio Vivo si un portal necesita atención (captcha, 2FA, credenciales).
    const attention = summaries.filter((s) => ["login_failed", "attention", "blocked"].includes(s.status));
    if (attention.length) {
      await notifyWorkspaceUrgentAlert(
        workspaceId,
        "RADAR_PORTAL_ATTENTION",
        `Portales que necesitan revisión: ${attention.map((s) => `${getPortal(s.portal)?.name ?? s.portal} (${s.detail ?? s.status})`).join("; ")}`
      ).catch(() => undefined);
    }
  } catch (error) {
    await prisma.radarRun.update({
      where: { id: runId },
      data: { status: "error", finishedAt: new Date(), leaseUntil: null, error: (error as Error).message?.slice(0, 500), summary: summaries as any },
    }).catch(() => undefined);
  }
}

/** Crea un run (programado/manual/prueba) si no hay otro en curso. */
export async function enqueueRun(workspaceId: string, trigger: "schedule" | "manual" | "test", sourceId?: string): Promise<{ runId: string | null; reason?: string }> {
  // Una en cola (aún sin lease, leaseUntil = null) o una en curso con lease
  // vigente bloquean una nueva. (Un `gt` sobre leaseUntil excluiría las NULL,
  // así que las encoladas se comprueban por estado.)
  const active = await prisma.radarRun.findFirst({
    where: {
      workspaceId,
      OR: [{ status: "queued" }, { status: "running", leaseUntil: { gt: new Date(Date.now() - RUN_LEASE_MS) } }],
    },
    select: { id: true },
  });
  if (active) return { runId: null, reason: "Ya hay una revisión en curso." };
  const run = await prisma.radarRun.create({ data: { workspaceId, trigger, sourceId: sourceId ?? null, status: "queued" } });
  return { runId: run.id };
}
