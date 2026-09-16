"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Cable,
  CheckCircle2,
  Expand,
  ExternalLink,
  Globe2,
  Home,
  Keyboard,
  Loader2,
  Maximize2,
  Power,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Square,
  Unplug
} from "lucide-react";
import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
  type AdbDaemonWebUsbConnection,
  type AdbDaemonWebUsbDeviceObserver
} from "@yume-chan/adb-daemon-webusb";
import {
  AdbScrcpyClient,
  AdbScrcpyOptionsLatest
} from "@yume-chan/adb-scrcpy";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer
} from "@yume-chan/scrcpy-decoder-webcodecs";
import PageHeader from "@/components/PageHeader";
import ConversationRadarPanel from "@/components/mobile/ConversationRadarPanel";
import MobileAutomationPanel from "@/components/mobile/MobileAutomationPanel";
import SharedPhoneInventory from "@/components/mobile/SharedPhoneInventory";
import {
  createAndroidAwakeSession,
  prepareAndroidForAutomation,
  type AndroidAwakeSession
} from "@/components/mobile/android-automation-ready";
import {
  findAndroidUiNodeCenter,
  parseAndroidUiNodes,
  readAndroidUiHierarchySafely,
  type AndroidUiPoint
} from "@/components/mobile/android-ui-hierarchy";
import {
  clearFocusedFacebookSearchInput,
  extractFacebookMembershipQuestions,
  findFacebookGroupJoinTarget,
  findFacebookMembershipState,
  findFacebookMembershipSubmitTarget,
  findFacebookSearchEntryTarget,
  findFacebookSearchSuggestionTarget,
  submitFacebookSearchFromKeyboard
} from "@/components/mobile/facebook-android-ui";
import {
  executeMobileAutomationJob,
  type MobileAutomationExecutableJob,
  type MobileAutomationExecutionResult
} from "@/components/mobile/mobile-automation-executor";
import { FacebookNavigationError, launchFacebookForAutomation, resolveLaunchableFacebookPackage } from "@/components/mobile/facebook-android-launch";
import { finishFacebookGroupSearch, runFacebookGroupCandidates } from "@/components/mobile/facebook-group-runner";
import { escapeAdbCommand } from "@/components/mobile/mobile-adb-command";
import { readMobileControlOutput } from "@/components/mobile/mobile-control-diagnostics";
import {
  closeMobileSessionResources,
  createMobileSessionAttemptTracker,
  createMobileSessionCoordinator,
  runBoundedMobileSessionCleanup
} from "@/components/mobile/mobile-session-coordinator";
import {
  formatAndroidProxy,
  getAndroidProxySyncState,
  normalizeAndroidProxy,
  parseAndroidProxy,
  type AndroidHttpProxy
} from "@/lib/mobile/android-proxy";
import { MAX_CONVERSATION_SCREENSHOT_BYTES } from "@/lib/mobile/conversation-radar";
import {
  serializeFacebookGroupBatch,
  type FacebookGroupBatch,
  type FacebookGroupCandidate
} from "@/lib/mobile/facebook-group-batch";
import type { SharedMobilePhone } from "@/lib/mobile/shared-phones";

type UsbDevice = AdbDaemonWebUsbDevice;
type AndroidKeyCodeValue = (typeof AndroidKeyCode)[keyof typeof AndroidKeyCode];
type SessionStatus =
  | "idle"
  | "connecting"
  | "authorizing"
  | "preparing"
  | "mirroring"
  | "stopping"
  | "error";

class MobileSessionAttemptCancelledError extends Error {
  constructor() {
    super("La conexiÃ³n anterior del mÃ³vil ha sido sustituida por una sesiÃ³n nueva.");
  }
}

const credentialStore = new AdbWebCredentialStore("F-Moviles@NegocioVivo");

type AndroidClipboardController = {
  setClipboard: (options: { sequence: bigint; paste: boolean; content: string }) => Promise<unknown>;
};

async function runAdbCommand(adb: Adb, command: readonly string[]): Promise<string> {
  const escapedCommand = escapeAdbCommand(command);
  const shell = adb.subprocess.shellProtocol;
  if (shell) {
    const result = await shell.spawnWaitText(escapedCommand);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "Android no ha aceptado el cambio de red.");
    }
    return result.stdout.trim();
  }
  return (await adb.subprocess.noneProtocol.spawnWaitText(escapedCommand)).trim();
}

async function runAdbBinary(adb: Adb, command: readonly string[]): Promise<Uint8Array> {
  const escapedCommand = escapeAdbCommand(command);
  const shell = adb.subprocess.shellProtocol;
  if (shell) {
    const result = await shell.spawnWait(escapedCommand);
    if (result.exitCode !== 0) {
      const detail = new TextDecoder().decode(result.stderr).trim();
      throw new Error(detail || "Android no ha podido capturar la pantalla.");
    }
    return result.stdout;
  }
  return adb.subprocess.noneProtocol.spawnWait(escapedCommand);
}

function waitForAndroidUi(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readAndroidUiHierarchy(adb: Adb): Promise<string> {
  return readAndroidUiHierarchySafely((command) => runAdbCommand(adb, command));
}

async function summarizeAndroidForeground(adb: Adb): Promise<string> {
  const focusedWindow = await runAdbCommand(adb, [
    "sh",
    "-c",
    "dumpsys window windows 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp|topResumedActivity' | head -n 6"
  ]).catch(() => "");
  const hierarchy = await readAndroidUiHierarchy(adb).catch(() => "");
  const nodes = hierarchy ? parseAndroidUiNodes(hierarchy) : [];
  const packages = Array.from(new Set(nodes.map((node) => node.packageName).filter(Boolean))).slice(0, 6);
  const labels = nodes
    .map((node) => (node.text.trim() || node.contentDescription.trim()))
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 16);
  const details = [
    String(focusedWindow).trim() ? `foco: ${String(focusedWindow).trim().replace(/\s+/g, " ")}` : "",
    packages.length ? `paquetes visibles: ${packages.join(", ")}` : "",
    labels.length ? `textos visibles: ${labels.join(" | ")}` : ""
  ].filter(Boolean);
  return details.length ? details.join(" · ") : "Android no ha devuelto detalle accesible de la pantalla actual.";
}

async function waitForFacebookSearchEntry(
  adb: Adb,
  knownQueries: readonly string[],
  onRetryLaunch: () => Promise<void>
): Promise<AndroidUiPoint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const hierarchy = await readAndroidUiHierarchy(adb);
      const target = findFacebookSearchEntryTarget(
        hierarchy,
        knownQueries
      );
      if (target) return target.point;
    } catch (error) {
      lastError = error;
    }
    if (attempt === 4) await onRetryLaunch();
    await waitForAndroidUi(900);
  }
  if (lastError instanceof Error && /estructura accesible/i.test(lastError.message)) throw lastError;
  throw new FacebookNavigationError(
    `Facebook no muestra un buscador accesible. Pantalla detectada: ${await summarizeAndroidForeground(adb)}`
  );
}

async function mobileApiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || "La automatización móvil no ha podido continuar.");
  }
  return payload;
}

async function resolveFacebookPackage(adb: Adb): Promise<string> {
  return resolveLaunchableFacebookPackage({
    runCommand: (command) => runAdbCommand(adb, command),
    readHierarchy: () => readAndroidUiHierarchy(adb)
  });
}

async function tapFacebookGroupsTabIfVisible(adb: Adb): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = findAndroidUiNodeCenter(await readAndroidUiHierarchy(adb), {
      labels: ["Grupos", "Groups"]
    });
    if (point) {
      await runAdbCommand(adb, ["input", "tap", String(point.x), String(point.y)]);
      await waitForAndroidUi(750);
      return true;
    }
    await waitForAndroidUi(500);
  }
  return false;
}

async function tapFacebookSearchSuggestionIfVisible(adb: Adb, query: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = findFacebookSearchSuggestionTarget(await readAndroidUiHierarchy(adb), query);
    if (point) {
      await runAdbCommand(adb, ["input", "tap", String(point.x), String(point.y)]);
      await waitForAndroidUi(1200);
      return true;
    }
    await waitForAndroidUi(500);
  }
  return false;
}

async function openFacebookGroupSearch(
  adb: Adb,
  controller: AndroidClipboardController,
  query: string,
  knownQueries: readonly string[] = [query]
): Promise<void> {
  try {
    await navigateFacebookGroupSearch(adb, controller, query, knownQueries);
  } catch (error) {
    throw error instanceof FacebookNavigationError ? error : new FacebookNavigationError(
      error instanceof Error ? error.message : "No se ha podido abrir la búsqueda de Facebook."
    );
  }
}

async function navigateFacebookGroupSearch(
  adb: Adb,
  controller: AndroidClipboardController,
  query: string,
  knownQueries: readonly string[] = [query]
): Promise<void> {
  await prepareAndroidForAutomation((command) => runAdbCommand(adb, command));
  await waitForAndroidUi(500);
  const facebookPackage = await resolveFacebookPackage(adb);
  const relaunchFacebook = () => launchFacebookForAutomation(facebookPackage, {
    runCommand: (command) => runAdbCommand(adb, command),
    readHierarchy: () => readAndroidUiHierarchy(adb),
    wait: waitForAndroidUi
  });
  await relaunchFacebook();

  const searchEntry = await waitForFacebookSearchEntry(adb, knownQueries, relaunchFacebook);
  await runAdbCommand(adb, ["input", "tap", String(searchEntry.x), String(searchEntry.y)]);
  await waitForAndroidUi(500);
  await clearFocusedFacebookSearchInput((command) => runAdbCommand(adb, command));
  await controller.setClipboard({ sequence: BigInt(Date.now()), paste: true, content: query });
  await waitForAndroidUi(250);
  await finishFacebookGroupSearch({
    selectSuggestion: () => tapFacebookSearchSuggestionIfVisible(adb, query),
    submitKeyboard: () => submitFacebookSearchFromKeyboard((command) => runAdbCommand(adb, command)),
    selectGroups: async () => {
      await waitForAndroidUi(750);
      return tapFacebookGroupsTabIfVisible(adb);
    }
  });
}
async function captureFacebookGroupScreens(adb: Adb, count = 5): Promise<string[]> {
  const screens: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = await runAdbBinary(adb, ["screencap", "-p"]);
    if (bytes.byteLength === 0) throw new Error("Android ha devuelto una captura vacía de los grupos.");
    screens.push(await compressScreenshot(bytes, 450_000));
    if (index < count - 1) {
      await runAdbCommand(adb, ["input", "swipe", "640", "500", "640", "170", "450"]);
      await waitForAndroidUi(650);
    }
  }
  return screens;
}

async function waitForFacebookJoinTarget(adb: Adb, groupName: string): Promise<AndroidUiPoint | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const hierarchy = await readAndroidUiHierarchy(adb);
    const membership = findFacebookMembershipState(hierarchy);
    if (membership) return null;
    const target = findFacebookGroupJoinTarget(hierarchy, groupName);
    if (target) return target;
    await waitForAndroidUi(500);
  }
  return null;
}

function withGroupOutcome(
  candidate: FacebookGroupCandidate,
  outcome: FacebookGroupCandidate["outcome"],
  resultDetail: string
): FacebookGroupCandidate {
  return { ...candidate, outcome, resultDetail: resultDetail.slice(0, 800) };
}

async function waitForFacebookMembershipState(adb: Adb): Promise<"joined" | "requested" | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = findFacebookMembershipState(await readAndroidUiHierarchy(adb));
    if (state) return state;
    await waitForAndroidUi(500);
  }
  return null;
}

async function joinSingleFacebookGroup(input: {
  adb: Adb;
  controller: AndroidClipboardController;
  candidate: FacebookGroupCandidate;
  batch: FacebookGroupBatch;
  phoneKey: string;
  deviceSerial: string;
}): Promise<FacebookGroupCandidate> {
  await openFacebookGroupSearch(
    input.adb,
    input.controller,
    input.candidate.name,
    [input.batch.query, ...input.batch.candidates.map((candidate) => candidate.name)]
  );
  const currentHierarchy = await readAndroidUiHierarchy(input.adb);
  const existingState = findFacebookMembershipState(currentHierarchy);
  if (existingState) {
    return withGroupOutcome(
      input.candidate,
      existingState,
      existingState === "joined" ? "La cuenta ya pertenece a este grupo." : "La solicitud ya estaba pendiente."
    );
  }

  const joinTarget = await waitForFacebookJoinTarget(input.adb, input.candidate.name);
  if (!joinTarget) {
    return withGroupOutcome(
      input.candidate,
      "failed",
      "No se ha podido asociar con seguridad este resultado con su botón «Unirte»."
    );
  }
  await runAdbCommand(input.adb, ["input", "tap", String(joinTarget.x), String(joinTarget.y)]);
  await waitForAndroidUi(800);

  let hierarchy = await readAndroidUiHierarchy(input.adb);
  const immediateState = findFacebookMembershipState(hierarchy);
  if (immediateState) {
    return withGroupOutcome(
      input.candidate,
      immediateState,
      immediateState === "joined" ? "Unión confirmada por Facebook." : "Solicitud enviada y confirmada por Facebook."
    );
  }

  const questions = extractFacebookMembershipQuestions(hierarchy);
  if (questions.length > 0) {
    if (!input.batch.membershipAnswers.trim()) {
      return withGroupOutcome(
        input.candidate,
        "needs_answers",
        `Facebook pide: ${questions.map((item) => item.question).join(" · ")}`
      );
    }
    const payload = await mobileApiJson("/api/v1/mobile/facebook/groups/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneKey: input.phoneKey,
        deviceSerial: input.deviceSerial,
        groupName: input.candidate.name,
        questions: questions.map((item) => item.question),
        answerFacts: input.batch.membershipAnswers
      })
    });
    const answers = Array.isArray(payload.answers) ? payload.answers : [];
    const unanswered = questions.filter((_, index) => typeof answers[index]?.answer !== "string" || !answers[index].answer.trim());
    if (unanswered.length > 0) {
      return withGroupOutcome(
        input.candidate,
        "needs_answers",
        `Faltan datos reales para: ${unanswered.map((item) => item.question).join(" · ")}`
      );
    }
    for (let index = 0; index < questions.length; index += 1) {
      const field = questions[index]!;
      await runAdbCommand(input.adb, ["input", "tap", String(field.point.x), String(field.point.y)]);
      await input.controller.setClipboard({
        sequence: BigInt(Date.now() + index),
        paste: true,
        content: answers[index].answer.trim()
      });
      await waitForAndroidUi(200);
    }
    await runAdbCommand(input.adb, ["input", "keyevent", "KEYCODE_BACK"]);
    await waitForAndroidUi(250);
    hierarchy = await readAndroidUiHierarchy(input.adb);
  }

  const submit = findFacebookMembershipSubmitTarget(hierarchy);
  if (submit) {
    await runAdbCommand(input.adb, ["input", "tap", String(submit.x), String(submit.y)]);
    await waitForAndroidUi(800);
  }
  const confirmedState = await waitForFacebookMembershipState(input.adb);
  if (!confirmedState) {
    return withGroupOutcome(
      input.candidate,
      "failed",
      "Facebook no ha mostrado una confirmación verificable de la unión o solicitud."
    );
  }
  return withGroupOutcome(
    input.candidate,
    confirmedState,
    confirmedState === "joined" ? "Unión confirmada por Facebook." : "Solicitud enviada y confirmada por Facebook."
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Chrome no ha podido procesar la captura."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function compressScreenshot(
  bytes: Uint8Array,
  maxBytes = MAX_CONVERSATION_SCREENSHOT_BYTES
): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
  try {
    const attempts = [
      { maxDimension: 1800, quality: 0.78 },
      { maxDimension: 1400, quality: 0.66 },
      { maxDimension: 1100, quality: 0.55 }
    ];
    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Chrome no ha podido preparar la captura.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("Chrome no ha podido comprimir la captura.")),
          "image/jpeg",
          attempt.quality
        );
      });
      if (blob.size <= maxBytes) return blobToDataUrl(blob);
    }
    throw new Error("La pantalla contiene demasiado detalle para analizarla. Reduce el tamaño de texto o prueba con menos comentarios visibles.");
  } finally {
    bitmap.close();
  }
}

async function readAndroidProxy(adb: Adb): Promise<AndroidHttpProxy | null> {
  return parseAndroidProxy(await runAdbCommand(adb, ["settings", "get", "global", "http_proxy"]));
}

function friendlyError(error: unknown): string {
  if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
    return "El móvil está ocupado por ADB, Android Studio o scrcpy. Cierra esas herramientas, desconecta el cable y vuelve a conectarlo.";
  }
  if (error instanceof DOMException && error.name === "NetworkError") {
    return "Chrome no ha podido abrir la interfaz USB. Comprueba el cable, el modo depuración USB y que otro programa no esté usando el móvil.";
  }
  const message = error instanceof Error ? error.message : String(error || "");
  if (/unauthorized|authentication|authenticate/i.test(message)) {
    return "Falta autorizar este ordenador. Desbloquea el móvil y acepta la huella de depuración USB.";
  }
  if (/scrcpy server exited/i.test(message)) {
    return "El móvil ha cerrado el servicio de pantalla. Comprueba que tenga Android 5 o superior y vuelve a intentarlo.";
  }
  return message || "No se ha podido conectar con el móvil.";
}

export default function MobileFarmClient() {
  const managerRef = useRef<AdbDaemonWebUsbDeviceManager>();
  const [devices, setDevices] = useState<readonly UsbDevice[]>([]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [sharedPhones, setSharedPhones] = useState<SharedMobilePhone[]>([]);
  const [clientStorageScope, setClientStorageScope] = useState("");
  const [canManagePhones, setCanManagePhones] = useState(false);
  const [phonesLoading, setPhonesLoading] = useState(true);
  const [phonesError, setPhonesError] = useState<string | null>(null);

  const loadSharedPhones = useCallback(async () => {
    setPhonesLoading(true);
    setPhonesError(null);
    try {
      const response = await fetch("/api/v1/mobile/devices", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || "No se ha podido cargar el inventario de teléfonos");
      }
      setSharedPhones(Array.isArray(payload?.items) ? payload.items : []);
      setClientStorageScope(typeof payload?.clientStorageScope === "string" ? payload.clientStorageScope : "");
      setCanManagePhones(Boolean(payload?.canManage));
    } catch (loadError) {
      setPhonesError(loadError instanceof Error ? loadError.message : "No se ha podido cargar el inventario de teléfonos");
    } finally {
      setPhonesLoading(false);
    }
  }, []);

  useEffect(() => { void loadSharedPhones(); }, [loadSharedPhones]);

  useEffect(() => {
    const refreshOnFocus = () => { void loadSharedPhones(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [loadSharedPhones]);

  useEffect(() => {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    managerRef.current = manager;
    setSupported(Boolean(manager && WebCodecsVideoDecoder.isSupported));
    if (!manager) return;

    let observer: AdbDaemonWebUsbDeviceObserver | undefined;
    let removeListener: (() => void) | undefined;
    let cancelled = false;

    manager.trackDevices().then((nextObserver) => {
      if (cancelled) {
        nextObserver.stop();
        return;
      }
      observer = nextObserver;
      removeListener = observer.onListChange((nextDevices) => {
        setDevices([...nextDevices]);
      });
    }).catch((error) => setDiscoveryError(friendlyError(error)));

    return () => {
      cancelled = true;
      removeListener?.();
      observer?.stop();
    };
  }, []);

  async function requestDevice() {
    const manager = managerRef.current;
    if (!manager) return;
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const device = await manager.requestDevice();
      if (device) {
        setDevices((current) =>
          current.some((item) => item.serial === device.serial)
            ? current
            : [...current, device]
        );
      }
    } catch (error) {
      setDiscoveryError(friendlyError(error));
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <PageHeader
        title="F - Móviles"
        description="Pantallas Android reales dentro del Hub, conectadas directamente por USB a este ordenador."
      />

      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 shadow-sm">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Sesión local
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                <Smartphone className="h-3.5 w-3.5" /> Android · Chrome
              </span>
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-900">El Hub no emula ni suplanta el teléfono</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              La app se ejecuta en el móvil real. El vídeo y los gestos viajan por USB y no se suben; el Radar solo envía una captura al proveedor de IA cuando tú pulsas analizar.
            </p>
          </div>
          <button
            type="button"
            onClick={requestDevice}
            disabled={!supported || discovering}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}
            {devices.length ? "Conectar otro móvil" : "Detectar móvil por USB"}
          </button>
        </div>
      </section>

      {supported === false && (
        <Notice tone="danger" icon={AlertTriangle}>
          Esta función necesita Google Chrome o Microsoft Edge actualizado, HTTPS y aceleración de vídeo WebCodecs. En iPhone no está disponible mediante WebUSB.
        </Notice>
      )}

      {discoveryError && (
        <Notice tone="danger" icon={AlertTriangle}>{discoveryError}</Notice>
      )}

      <SharedPhoneInventory
        items={sharedPhones}
        connectedDevices={devices.map((device) => ({ serial: device.serial, name: device.name || "Android" }))}
        canManage={canManagePhones}
        loading={phonesLoading}
        error={phonesError}
        onReload={loadSharedPhones}
      />

      {devices.length === 0 ? (
        <EmptyState onConnect={requestDevice} disabled={!supported || discovering} />
      ) : (
        <section className="grid gap-5 xl:grid-cols-2" aria-label="Móviles conectados">
          {devices.map((device) => (
            <MobileDeviceCard
              key={device.serial}
              device={device}
              linkedPhone={sharedPhones.find((phone) => phone.deviceSerial === device.serial) ?? null}
              clientStorageScope={clientStorageScope}
            />
          ))}
        </section>
      )}

      <Notice tone="warning" icon={AlertTriangle}>
        Usar el dispositivo real y una salida de red estable reduce cambios técnicos innecesarios, pero no puede garantizar “cero baneos”. Las automatizaciones supervisadas preparan destinos y borradores aprobados; no publican por ti, no falsifican la ubicación y no generan interacción artificial.
      </Notice>
    </div>
  );
}

function EmptyState({ onConnect, disabled }: { onConnect: () => void; disabled: boolean }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Smartphone className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-base font-bold text-slate-900">Aún no hay móviles autorizados</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        Activa <strong>Opciones de desarrollador → Depuración USB</strong>, conecta el cable y pulsa detectar. Chrome pedirá permiso una vez y después reconocerá ese móvil automáticamente.
      </p>
      <button
        type="button"
        onClick={onConnect}
        disabled={disabled}
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        <Cable className="h-4 w-4" /> Elegir móvil
      </button>
      <div className="mx-auto mt-7 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
        {[
          ["1", "Depuración USB", "Actívala en el Android."],
          ["2", "Permiso de Chrome", "Selecciona el móvil en la ventana."],
          ["3", "Huella RSA", "Acepta el aviso en el teléfono."]
        ].map(([step, title, text]) => (
          <div key={step} className="rounded-xl bg-slate-50 p-3">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{step}</span>
            <div className="mt-2 text-sm font-semibold text-slate-800">{title}</div>
            <div className="mt-0.5 text-xs text-slate-500">{text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MobileDeviceCard({
  device,
  linkedPhone,
  clientStorageScope
}: {
  device: UsbDevice;
  linkedPhone: SharedMobilePhone | null;
  clientStorageScope: string;
}) {
  const screenMountRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const adbRef = useRef<Adb>();
  const connectionRef = useRef<AdbDaemonWebUsbConnection>();
  const connectionPromiseRef = useRef<Promise<AdbDaemonWebUsbConnection>>();
  const startSessionPromiseRef = useRef<Promise<void>>();
  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>>();
  const awakeSessionRef = useRef<AndroidAwakeSession>();
  const closeSessionPromiseRef = useRef<Promise<void>>();
  const decoderRef = useRef<WebCodecsVideoDecoder>();
  const sessionCoordinatorRef = useRef<ReturnType<typeof createMobileSessionCoordinator>>();
  const [sessionAttemptTracker] = useState(createMobileSessionAttemptTracker);
  const sizeRef = useRef({ width: 0, height: 0 });
  const closingRef = useRef(false);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(device.name || "Android");
  const [androidVersion, setAndroidVersion] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [appliedProxy, setAppliedProxy] = useState<AndroidHttpProxy | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [ipAuthorizationConfirmed, setIpAuthorizationConfirmed] = useState(false);
  const [proxyFeedback, setProxyFeedback] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  useEffect(() => {
    const storageKey = `nv-mobile-proxy:${device.serial}`;
    try {
      if (linkedPhone?.androidProxy) {
        setProxyHost(linkedPhone.androidProxy.host);
        setProxyPort(String(linkedPhone.androidProxy.port));
        return;
      }
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const draft = JSON.parse(saved) as { host?: unknown; port?: unknown };
      const proxy = normalizeAndroidProxy(String(draft.host ?? ""), String(draft.port ?? ""));
      setProxyHost(proxy.host);
      setProxyPort(String(proxy.port));
    } catch {
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    }
  }, [device.serial, linkedPhone]);

  useEffect(() => {
    setIpAuthorizationConfirmed(false);
  }, [linkedPhone?.androidProxy?.host, linkedPhone?.androidProxy?.port]);

  const closeSession = useCallback(() => {
    sessionAttemptTracker.invalidate();
    if (closeSessionPromiseRef.current) return closeSessionPromiseRef.current;
    closingRef.current = true;
    const closePromise = (async () => {
      decoderRef.current?.dispose();
      decoderRef.current = undefined;
      screenMountRef.current?.replaceChildren();
      const awakeSession = awakeSessionRef.current;
      const client = clientRef.current;
      const adb = adbRef.current;
      const connection = connectionRef.current;
      const pendingConnection = connectionPromiseRef.current;
      awakeSessionRef.current = undefined;
      clientRef.current = undefined;
      adbRef.current = undefined;
      connectionRef.current = undefined;
      connectionPromiseRef.current = undefined;
      sizeRef.current = { width: 0, height: 0 };
      await closeMobileSessionResources({
        awakeSession,
        client,
        adb,
        connection,
        pendingConnection
      });
    })();
    closeSessionPromiseRef.current = closePromise;
    const clearClosePromise = () => {
      if (closeSessionPromiseRef.current === closePromise) {
        closeSessionPromiseRef.current = undefined;
      }
    };
    void closePromise.then(clearClosePromise, clearClosePromise);
    return closePromise;
  }, [sessionAttemptTracker]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return () => { void closeSession(); };
    }
    const coordinator = createMobileSessionCoordinator({
      serial: device.serial,
      release: async () => {
        const pendingStart = startSessionPromiseRef.current;
        closingRef.current = true;
        setStatus((current) => current === "idle" ? current : "stopping");
        await closeSession();
        if (pendingStart) {
          await runBoundedMobileSessionCleanup([async () => { await pendingStart; }], 3_000);
          await closeSession();
        }
        closingRef.current = false;
        setStatus("idle");
      }
    });
    sessionCoordinatorRef.current = coordinator;
    return () => {
      if (sessionCoordinatorRef.current === coordinator) {
        sessionCoordinatorRef.current = undefined;
      }
      coordinator.close();
      void closeSession();
    };
  }, [closeSession, device.serial]);

  async function startMirroring(): Promise<boolean> {
    if (status === "mirroring") return true;
    if (status !== "idle" && status !== "error") return false;
    let finishStartSession: () => void = () => {};
    const startSessionPromise = new Promise<void>((resolve) => {
      finishStartSession = resolve;
    });
    startSessionPromiseRef.current = startSessionPromise;
    const sessionAttempt = sessionAttemptTracker.begin();
    const assertCurrentSessionAttempt = () => {
      if (!sessionAttempt.isCurrent()) throw new MobileSessionAttemptCancelledError();
    };
    closingRef.current = false;
    setError(null);
    setResolution(null);
    setStatus("connecting");

    try {
      await sessionCoordinatorRef.current?.requestRelease();
      assertCurrentSessionAttempt();
      const connectionPromise = device.connect();
      connectionPromiseRef.current = connectionPromise;
      const connection = await connectionPromise;
      if (connectionPromiseRef.current === connectionPromise) {
        connectionPromiseRef.current = undefined;
      }
      connectionRef.current = connection;
      if (!sessionAttempt.isCurrent()) {
        await runBoundedMobileSessionCleanup([
          async () => { await connection.device.raw.close(); }
        ]);
        throw new MobileSessionAttemptCancelledError();
      }
      setStatus("authorizing");
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore
      });
      const adb = new Adb(transport);
      adbRef.current = adb;
      assertCurrentSessionAttempt();
      const awakeSession = createAndroidAwakeSession(
        (command) => runAdbCommand(adb, command)
      );
      awakeSessionRef.current = awakeSession;
      await awakeSession.ready;
      assertCurrentSessionAttempt();

      const [reportedModel, version] = await Promise.all([
        adb.getProp("ro.product.model").catch(() => adb.banner.model || device.name || "Android"),
        adb.getProp("ro.build.version.release").catch(() => "")
      ]);
      assertCurrentSessionAttempt();
      setModel(reportedModel || device.name || "Android");
      setAndroidVersion(version || null);
      let currentProxy = await readAndroidProxy(adb).catch(() => null);
      assertCurrentSessionAttempt();
      const configuredProxy = linkedPhone?.androidProxy ?? null;
      if (
        configuredProxy
        && !configuredProxy.requiresIpAuthorization
        && formatAndroidProxy(configuredProxy) !== (currentProxy ? formatAndroidProxy(currentProxy) : "")
      ) {
        await runAdbCommand(adb, ["settings", "put", "global", "http_proxy", formatAndroidProxy(configuredProxy)]);
        assertCurrentSessionAttempt();
        currentProxy = await readAndroidProxy(adb);
        assertCurrentSessionAttempt();
        if (!currentProxy || formatAndroidProxy(currentProxy) !== formatAndroidProxy(configuredProxy)) {
          throw new Error("Android no ha confirmado el proxy configurado en NV Leads.");
        }
        setProxyFeedback({
          tone: "success",
          text: `Proxy de NV Leads aplicado automáticamente: ${formatAndroidProxy(currentProxy)}.`
        });
      }
      setAppliedProxy(currentProxy);
      if (configuredProxy) {
        setProxyHost(configuredProxy.host);
        setProxyPort(String(configuredProxy.port));
      } else if (currentProxy) {
        setProxyHost(currentProxy.host);
        setProxyPort(String(currentProxy.port));
      }

      setStatus("preparing");
      const serverResponse = await fetch("/api/v1/mobile/scrcpy-server", { cache: "force-cache" });
      assertCurrentSessionAttempt();
      if (!serverResponse.ok || !serverResponse.body) {
        const detail = await serverResponse.json().catch(() => null);
        throw new Error(detail?.error?.message || detail?.message || "No se ha podido descargar el servicio de pantalla");
      }
      await AdbScrcpyClient.pushServer(adb, serverResponse.body as never);
      assertCurrentSessionAttempt();

      const options = new AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        maxSize: 1280,
        videoBitRate: 4_000_000,
        maxFps: 30,
        stayAwake: true,
        clipboardAutosync: true
      });
      const client = await AdbScrcpyClient.start(adb, "/data/local/tmp/scrcpy-server.jar", options);
      clientRef.current = client;
      // Drain the server stream: input permission errors otherwise remain
      // invisible while the video stream still appears healthy.
      void readMobileControlOutput(client.output, (message) => {
        if (clientRef.current === client && !closingRef.current) setError(message);
      }).catch(() => {
        // Session teardown closes this stream; the video/USB lifecycle owns
        // disconnection reporting.
      });
      assertCurrentSessionAttempt();
      const video = await client.videoStream;
      assertCurrentSessionAttempt();
      if (!video) throw new Error("El móvil no ha entregado una señal de vídeo");

      const renderer = WebGLVideoFrameRenderer.isSupported
        ? new WebGLVideoFrameRenderer()
        : new BitmapVideoFrameRenderer();
      const canvas = renderer.canvas as HTMLCanvasElement;
      canvas.className = "block max-h-[72vh] max-w-full select-none rounded-lg";
      canvas.style.touchAction = "none";
      canvas.setAttribute("aria-label", `Pantalla de ${reportedModel || device.name || "Android"}`);
      screenMountRef.current?.replaceChildren(canvas);

      const decoder = new WebCodecsVideoDecoder({ codec: video.metadata.codec, renderer });
      decoderRef.current = decoder;
      decoder.sizeChanged(({ width, height }) => {
        sizeRef.current = { width, height };
        setResolution(`${width} × ${height}`);
      });
      video.stream.pipeTo(decoder.writable).catch(async (pipeError) => {
        if (closingRef.current) return;
        await closeSession();
        closingRef.current = false;
        setError(friendlyError(pipeError));
        setStatus("error");
      });
      assertCurrentSessionAttempt();
      setStatus("mirroring");
      return true;
    } catch (startError) {
      const cancelled = startError instanceof MobileSessionAttemptCancelledError;
      await closeSession();
      closingRef.current = false;
      if (cancelled) {
        setStatus("idle");
        return false;
      }
      setError(friendlyError(startError));
      setStatus("error");
      return false;
    } finally {
      finishStartSession();
      if (startSessionPromiseRef.current === startSessionPromise) {
        startSessionPromiseRef.current = undefined;
      }
    }
  }

  async function stopMirroring() {
    if (status === "stopping") return;
    setStatus("stopping");
    await closeSession();
    closingRef.current = false;
    setStatus("idle");
  }

  async function sendKey(keyCode: AndroidKeyCodeValue) {
    const controller = clientRef.current?.controller;
    if (!controller) return;
    try {
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode,
        repeat: 0,
        metaState: AndroidKeyEventMeta.None
      });
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode,
        repeat: 0,
        metaState: AndroidKeyEventMeta.None
      });
    } catch (controlError) {
      setError(friendlyError(controlError));
    }
  }

  async function pasteText() {
    const controller = clientRef.current?.controller;
    const content = text.trim();
    if (!controller || !content) return;
    try {
      await controller.setClipboard({ sequence: 0n, paste: true, content });
      setText("");
    } catch (controlError) {
      setError(friendlyError(controlError));
    }
  }

  const executeApprovedAutomation = useCallback(async (job: MobileAutomationExecutableJob) => {
    const adb = adbRef.current;
    const controller = clientRef.current?.controller;
    if (!adb || !controller || status !== "mirroring") {
      throw new Error("La pantalla del móvil debe estar abierta para preparar el trabajo.");
    }
    if (!awakeSessionRef.current) {
      throw new Error("La protección de pantalla de Android no está activa.");
    }
    return executeMobileAutomationJob(job, {
      openUrl: (url) => runAdbCommand(adb, [
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        url
      ]),
      copyText: (content) => controller.setClipboard({
        sequence: BigInt(Date.now()),
        paste: false,
        content
      }),
      searchFacebookGroups: (query) => openFacebookGroupSearch(adb, controller, query),
      discoverFacebookGroups: async (batch): Promise<MobileAutomationExecutionResult> => {
        if (!job.phoneKey || !job.deviceSerial) {
          throw new Error("El trabajo no está asociado correctamente con este móvil.");
        }
        await openFacebookGroupSearch(adb, controller, batch.query);
        const screenImages = await captureFacebookGroupScreens(adb);
        const payload = await mobileApiJson("/api/v1/mobile/facebook/groups/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneKey: job.phoneKey,
            deviceSerial: job.deviceSerial,
            query: batch.query,
            criteria: batch.criteria,
            maxGroups: batch.maxGroups,
            screenImages
          })
        });
        const analyzed = {
          ...batch,
          candidates: Array.isArray(payload.candidates) ? payload.candidates : []
        };
        return {
          outcome: "DISCOVERED",
          resultText: serializeFacebookGroupBatch(analyzed),
          summary: `${analyzed.candidates.length} grupos analizados.`
        };
      },
      joinFacebookGroupBatch: async (batch): Promise<MobileAutomationExecutionResult> => {
        if (!job.phoneKey || !job.deviceSerial) {
          throw new Error("El lote no está asociado correctamente con este móvil.");
        }
        const updatedCandidates = await runFacebookGroupCandidates(
          batch.candidates,
          (candidate) => joinSingleFacebookGroup({
            adb, controller, candidate, batch,
            phoneKey: job.phoneKey!, deviceSerial: job.deviceSerial!
          }),
          () => waitForAndroidUi(3_000)
        );
        const resultBatch = { ...batch, candidates: updatedCandidates };
        const selected = updatedCandidates.filter((candidate) => candidate.selected);
        const completed = selected.filter((candidate) => ["joined", "requested"].includes(candidate.outcome));
        const needsReview = selected.filter((candidate) => ["needs_answers", "failed"].includes(candidate.outcome));
        return {
          outcome: needsReview.length > 0 ? "PARTIAL" : "COMPLETED",
          resultText: serializeFacebookGroupBatch(resultBatch),
          summary: needsReview.length > 0
            ? `${completed.length} procesados y ${needsReview.length} necesitan revisión.`
            : `${completed.length} grupos procesados por Facebook.`
        };
      }
    });
  }, [status]);

  const pasteApprovedAutomation = useCallback(async (content: string) => {
    const controller = clientRef.current?.controller;
    if (!controller || status !== "mirroring") {
      throw new Error("La pantalla del móvil debe estar abierta para pegar el texto.");
    }
    await controller.setClipboard({
      sequence: BigInt(Date.now()),
      paste: true,
      content
    });
  }, [status]);

  const copyApprovedConversation = useCallback(async (content: string) => {
    const controller = clientRef.current?.controller;
    if (!controller || status !== "mirroring") {
      throw new Error("La pantalla del móvil debe estar abierta para copiar el texto.");
    }
    await controller.setClipboard({
      sequence: BigInt(Date.now()),
      paste: false,
      content
    });
  }, [status]);

  const captureVisibleScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb || status !== "mirroring") {
      throw new Error("La pantalla del móvil debe estar abierta para analizarla.");
    }
    const bytes = await runAdbBinary(adb, ["screencap", "-p"]);
    if (bytes.byteLength === 0) throw new Error("Android ha devuelto una captura vacía.");
    return compressScreenshot(bytes);
  }, [status]);

  async function applyProxy() {
    const adb = adbRef.current;
    if (!adb) return;
    setProxyBusy(true);
    setProxyFeedback(null);
    try {
      if (linkedPhone?.androidProxy?.requiresIpAuthorization && !ipAuthorizationConfirmed) {
        throw new Error("Confirma primero que la IP pública actual está autorizada en DataImpulse.");
      }
      const proxy = normalizeAndroidProxy(proxyHost, proxyPort);
      await runAdbCommand(adb, ["settings", "put", "global", "http_proxy", formatAndroidProxy(proxy)]);
      const confirmed = await readAndroidProxy(adb);
      if (!confirmed || formatAndroidProxy(confirmed) !== formatAndroidProxy(proxy)) {
        throw new Error("Android no ha confirmado el proxy configurado.");
      }
      setAppliedProxy(confirmed);
      try {
        localStorage.setItem(`nv-mobile-proxy:${device.serial}`, JSON.stringify(confirmed));
      } catch { /* the Android setting is already applied; remembering the draft is optional */ }
      setProxyFeedback({
        tone: "success",
        text: `Proxy fijo aplicado: ${formatAndroidProxy(confirmed)}. Permanecerá activo al desconectar el cable.`
      });
    } catch (proxyError) {
      setProxyFeedback({ tone: "danger", text: friendlyError(proxyError) });
    } finally {
      setProxyBusy(false);
    }
  }

  async function clearProxy() {
    const adb = adbRef.current;
    if (!adb) return;
    setProxyBusy(true);
    setProxyFeedback(null);
    try {
      await runAdbCommand(adb, ["settings", "put", "global", "http_proxy", ":0"]);
      const confirmed = await readAndroidProxy(adb);
      if (confirmed) throw new Error("Android todavía informa de un proxy activo.");
      setAppliedProxy(null);
      setProxyFeedback({ tone: "info", text: "Proxy retirado. El móvil vuelve a usar directamente su Wi-Fi o sus datos móviles." });
    } catch (proxyError) {
      setProxyFeedback({ tone: "danger", text: friendlyError(proxyError) });
    } finally {
      setProxyBusy(false);
    }
  }

  async function openIpCheck() {
    const adb = adbRef.current;
    if (!adb) return;
    setProxyBusy(true);
    setProxyFeedback(null);
    try {
      await runAdbCommand(adb, [
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "https://api.ipify.org"
      ]);
      setProxyFeedback({ tone: "info", text: "Se ha abierto el verificador en el teléfono. La IP mostrada es la salida real del dispositivo." });
    } catch (proxyError) {
      setProxyFeedback({ tone: "danger", text: friendlyError(proxyError) });
    } finally {
      setProxyBusy(false);
    }
  }

  async function handlePointer(event: PointerEvent<HTMLDivElement>) {
    const controller = clientRef.current?.controller;
    const target = screenMountRef.current;
    const { width, height } = sizeRef.current;
    if (!controller || !target || !width || !height || status !== "mirroring") return;
    if (event.type === "pointermove" && event.buttons === 0) return;

    event.preventDefault();
    if (event.type === "pointerdown") target.setPointerCapture(event.pointerId);

    const rect = target.getBoundingClientRect();
    const pointerX = Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width));
    const pointerY = Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height));
    const action = event.type === "pointerdown"
      ? AndroidMotionEventAction.Down
      : event.type === "pointermove"
        ? AndroidMotionEventAction.Move
        : AndroidMotionEventAction.Up;

    try {
      await controller.injectTouch({
        action,
        pointerId: BigInt(event.pointerId),
        pointerX,
        pointerY,
        videoWidth: width,
        videoHeight: height,
        pressure: action === AndroidMotionEventAction.Up ? 0 : (event.pressure || 1),
        actionButton: action === AndroidMotionEventAction.Down || action === AndroidMotionEventAction.Up
          ? AndroidMotionEventButton.Primary
          : AndroidMotionEventButton.None,
        buttons: action === AndroidMotionEventAction.Up ? AndroidMotionEventButton.None : AndroidMotionEventButton.Primary
      });
    } catch (controlError) {
      setError(friendlyError(controlError));
    }
  }

  const busy = ["connecting", "authorizing", "preparing", "stopping"].includes(status);
  const configuredProxy = linkedPhone?.androidProxy ?? null;
  const proxySyncState = getAndroidProxySyncState(configuredProxy, appliedProxy);

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900">{model}</h2>
            <p className="truncate text-xs text-slate-500">
              {device.serial}{androidVersion ? ` · Android ${androidVersion}` : ""}{resolution ? ` · ${resolution}` : ""}
            </p>
            <p className={`mt-0.5 truncate text-[11px] font-semibold ${linkedPhone ? "text-indigo-700" : "text-amber-700"}`}>
              {linkedPhone ? `${linkedPhone.label || linkedPhone.sessionName} · ${linkedPhone.phone || "número pendiente"}` : "Sin número compartido asociado"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {appliedProxy && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800">
              <Globe2 className="h-3.5 w-3.5" /> Proxy · {formatAndroidProxy(appliedProxy)}
            </span>
          )}
          <StatusBadge status={status} />
        </div>
      </header>

      <div ref={fullscreenRef} className="bg-slate-950 p-3">
        <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black">
          {status === "mirroring" || (busy && screenMountRef.current?.childElementCount) ? null : (
            <div className="px-6 text-center text-slate-400">
              {busy ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-400" /> : <Smartphone className="mx-auto h-10 w-10" />}
              <p className="mt-3 text-sm font-semibold text-slate-200">{statusLabel(status)}</p>
              {status === "authorizing" && <p className="mt-1 text-xs">Acepta la huella RSA en el teléfono.</p>}
            </div>
          )}
          <div
            ref={screenMountRef}
            onPointerDown={handlePointer}
            onPointerMove={handlePointer}
            onPointerUp={handlePointer}
            onPointerCancel={handlePointer}
            className="inline-flex max-h-[72vh] max-w-full touch-none items-center justify-center"
          />
        </div>

        {status === "mirroring" && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-white">
            <ControlButton label="Atrás" icon={ArrowLeft} onClick={() => sendKey(AndroidKeyCode.AndroidBack)} />
            <ControlButton label="Inicio" icon={Home} onClick={() => sendKey(AndroidKeyCode.AndroidHome)} />
            <ControlButton label="Recientes" icon={Square} onClick={() => sendKey(AndroidKeyCode.AndroidAppSwitch)} />
            <ControlButton label="Encender" icon={Power} onClick={() => sendKey(AndroidKeyCode.Power)} />
            <ControlButton label="Girar" icon={RotateCw} onClick={() => clientRef.current?.controller?.rotateDevice()} />
            <ControlButton label="Pantalla completa" icon={Maximize2} onClick={() => fullscreenRef.current?.requestFullscreen()} />
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {status === "mirroring" && (
          <form onSubmit={(event) => { event.preventDefault(); void pasteText(); }} className="flex gap-2">
            <div className="relative flex-1">
              <Keyboard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Escribir o pegar texto en el móvil"
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <button type="submit" disabled={!text.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Enviar
            </button>
          </form>
        )}

        {status === "mirroring" && (
          <section className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3" aria-label="Proxy del móvil">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Globe2 className="h-4 w-4 text-cyan-700" /> Salida de red estable
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Proxy HTTP fijo del Android. Usa un proxy sin credenciales o autorizado por IP; Android no admite usuario y contraseña en esta configuración global.
                  Algunas apps nativas pueden ignorar el proxy HTTP; para forzar todo el tráfico hace falta una VPN instalada en el móvil.
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                proxySyncState === "synced"
                  ? "bg-emerald-100 text-emerald-800"
                  : proxySyncState === "needs-ip-authorization"
                    ? "bg-amber-100 text-amber-800"
                    : appliedProxy
                      ? "bg-cyan-100 text-cyan-800"
                      : "bg-slate-200 text-slate-700"
              }`}>
                {proxySyncState === "synced"
                  ? `Sincronizado · ${formatAndroidProxy(appliedProxy!)}`
                  : proxySyncState === "needs-ip-authorization"
                    ? "Pendiente de autorizar IP"
                    : appliedProxy
                      ? `Activo · ${formatAndroidProxy(appliedProxy)}`
                      : "Red directa"}
              </span>
            </div>

            {configuredProxy && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
                configuredProxy.requiresIpAuthorization
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}>
                <p className="font-semibold">
                  NV Leads: {formatAndroidProxy(configuredProxy)} · {configuredProxy.source === "number" ? "proxy propio del número" : "proxy global heredado"}
                </p>
                {configuredProxy.requiresIpAuthorization && proxySyncState !== "synced" && (
                  <>
                    <p>
                      La URL guardada usa credenciales. Para que Android pueda usar este mismo destino sin exponerlas,
                      autoriza primero la IP pública actual en DataImpulse.
                    </p>
                    <label className="mt-1 flex items-start gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={ipAuthorizationConfirmed}
                        onChange={(event) => setIpAuthorizationConfirmed(event.target.checked)}
                        className="mt-1 accent-amber-600"
                      />
                      Ya he autorizado esta IP en DataImpulse
                    </label>
                    <a
                      href="https://docs.dataimpulse.com/authentication-methods/whitelist-ips"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-semibold underline"
                    >
                      Abrir instrucciones de DataImpulse <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </div>
            )}

            <form onSubmit={(event) => { event.preventDefault(); void applyProxy(); }} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
              <input
                value={proxyHost}
                onChange={(event) => setProxyHost(event.target.value)}
                readOnly={Boolean(configuredProxy)}
                placeholder="proxy.ejemplo.com"
                aria-label="Host del proxy"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              <input
                value={proxyPort}
                onChange={(event) => setProxyPort(event.target.value)}
                readOnly={Boolean(configuredProxy)}
                placeholder="8080"
                aria-label="Puerto del proxy"
                inputMode="numeric"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              <button
                type="submit"
                disabled={
                  proxyBusy
                  || !proxyHost.trim()
                  || !proxyPort.trim()
                  || (proxySyncState === "needs-ip-authorization" && !ipAuthorizationConfirmed)
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                {proxyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {configuredProxy ? "Aplicar el de NV Leads" : "Aplicar"}
              </button>
            </form>

            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void openIpCheck()} disabled={proxyBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-900 hover:bg-cyan-100 disabled:opacity-50">
                <ExternalLink className="h-3.5 w-3.5" /> Verificar IP real
              </button>
              <button type="button" onClick={() => void clearProxy()} disabled={proxyBusy || !appliedProxy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                Quitar proxy
              </button>
            </div>

            {proxyFeedback && (
              <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                proxyFeedback.tone === "success"
                  ? "bg-emerald-100 text-emerald-800"
                  : proxyFeedback.tone === "danger"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-sky-100 text-sky-800"
              }`}>
                {proxyFeedback.text}
              </p>
            )}
          </section>
        )}

        {linkedPhone ? (
          <>
            <ConversationRadarPanel
              deviceSerial={device.serial}
              phoneKey={linkedPhone.key}
              storageScope={clientStorageScope}
              ready={status === "mirroring"}
              onCaptureScreen={captureVisibleScreen}
              onCopyText={copyApprovedConversation}
              onPasteText={pasteApprovedAutomation}
            />
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-slate-700">Acciones individuales y borradores programados</summary>
              <div className="px-2 pb-2">
                <MobileAutomationPanel
                  deviceSerial={device.serial}
                  phoneKey={linkedPhone.key}
                  ready={status === "mirroring"}
                  onEnsureReady={startMirroring}
                  onExecuteJob={executeApprovedAutomation}
                  onPasteText={pasteApprovedAutomation}
                />
              </div>
            </details>
          </>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            Asocia este Android a un número compartido para habilitar el Centro de automatizaciones.
          </div>
        )}

        {status === "mirroring" ? (
          <button type="button" onClick={stopMirroring} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">
            <Unplug className="h-4 w-4" /> Cerrar pantalla
          </button>
        ) : (
          <button type="button" onClick={startMirroring} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "error" ? <RefreshCw className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            {status === "error" ? "Reintentar" : busy ? statusLabel(status) : "Abrir y controlar pantalla"}
          </button>
        )}
      </div>
    </article>
  );
}

function statusLabel(status: SessionStatus) {
  switch (status) {
    case "connecting": return "Conectando por USB…";
    case "authorizing": return "Esperando autorización…";
    case "preparing": return "Preparando pantalla…";
    case "mirroring": return "En directo";
    case "stopping": return "Cerrando…";
    case "error": return "Conexión interrumpida";
    default: return "Listo para abrir";
  }
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const live = status === "mirroring";
  const error = status === "error";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      live ? "bg-emerald-100 text-emerald-800" : error ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"
    }`}>
      {live ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className={`h-2 w-2 rounded-full ${error ? "bg-rose-500" : "bg-slate-400"}`} />}
      {statusLabel(status)}
    </span>
  );
}

function ControlButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Home; onClick: () => void | Promise<unknown> }) {
  return (
    <button type="button" onClick={() => void onClick()} title={label} aria-label={label} className="inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 text-xs font-medium hover:bg-white/20">
      <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Notice({ tone, icon: Icon, children }: { tone: "warning" | "danger"; icon: typeof AlertTriangle; children: ReactNode }) {
  const classes = tone === "danger"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm leading-6 ${classes}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
