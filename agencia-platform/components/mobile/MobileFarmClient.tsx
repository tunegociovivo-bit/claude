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
import SharedPhoneInventory from "@/components/mobile/SharedPhoneInventory";
import {
  formatAndroidProxy,
  normalizeAndroidProxy,
  parseAndroidProxy,
  type AndroidHttpProxy
} from "@/lib/mobile/android-proxy";
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

const credentialStore = new AdbWebCredentialStore("F-Moviles@NegocioVivo");

async function runAdbCommand(adb: Adb, command: readonly string[]): Promise<string> {
  const shell = adb.subprocess.shellProtocol;
  if (shell) {
    const result = await shell.spawnWaitText(command);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "Android no ha aceptado el cambio de red.");
    }
    return result.stdout.trim();
  }
  return (await adb.subprocess.noneProtocol.spawnWaitText(command)).trim();
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
              La app se ejecuta en el móvil real. El vídeo y los gestos viajan por el cable USB y no se guardan ni se suben al servidor.
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
            />
          ))}
        </section>
      )}

      <Notice tone="warning" icon={AlertTriangle}>
        Usar el dispositivo real y una salida de red estable reduce cambios técnicos innecesarios, pero no puede garantizar “cero baneos”. Meta, Instagram y Google también valoran la actividad, la identidad de la cuenta y el cumplimiento de sus normas. F - Móviles no falsifica el dispositivo, no rota IPs y no automatiza acciones.
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

function MobileDeviceCard({ device, linkedPhone }: { device: UsbDevice; linkedPhone: SharedMobilePhone | null }) {
  const screenMountRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const adbRef = useRef<Adb>();
  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>>();
  const decoderRef = useRef<WebCodecsVideoDecoder>();
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
  const [proxyFeedback, setProxyFeedback] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  useEffect(() => {
    const storageKey = `nv-mobile-proxy:${device.serial}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const draft = JSON.parse(saved) as { host?: unknown; port?: unknown };
      const proxy = normalizeAndroidProxy(String(draft.host ?? ""), String(draft.port ?? ""));
      setProxyHost(proxy.host);
      setProxyPort(String(proxy.port));
    } catch {
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    }
  }, [device.serial]);

  const closeSession = useCallback(async () => {
    closingRef.current = true;
    decoderRef.current?.dispose();
    decoderRef.current = undefined;
    screenMountRef.current?.replaceChildren();
    try { await clientRef.current?.close(); } catch { /* already disconnected */ }
    clientRef.current = undefined;
    try { await adbRef.current?.close(); } catch { /* already disconnected */ }
    adbRef.current = undefined;
    sizeRef.current = { width: 0, height: 0 };
  }, []);

  useEffect(() => () => { void closeSession(); }, [closeSession]);

  async function startMirroring() {
    if (status !== "idle" && status !== "error") return;
    closingRef.current = false;
    setError(null);
    setResolution(null);
    setStatus("connecting");

    try {
      const connection = await device.connect();
      setStatus("authorizing");
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore
      });
      const adb = new Adb(transport);
      adbRef.current = adb;

      const [reportedModel, version] = await Promise.all([
        adb.getProp("ro.product.model").catch(() => adb.banner.model || device.name || "Android"),
        adb.getProp("ro.build.version.release").catch(() => "")
      ]);
      setModel(reportedModel || device.name || "Android");
      setAndroidVersion(version || null);
      const currentProxy = await readAndroidProxy(adb).catch(() => null);
      setAppliedProxy(currentProxy);
      if (currentProxy) {
        setProxyHost(currentProxy.host);
        setProxyPort(String(currentProxy.port));
      }

      setStatus("preparing");
      const serverResponse = await fetch("/api/v1/mobile/scrcpy-server", { cache: "force-cache" });
      if (!serverResponse.ok || !serverResponse.body) {
        const detail = await serverResponse.json().catch(() => null);
        throw new Error(detail?.error?.message || detail?.message || "No se ha podido descargar el servicio de pantalla");
      }
      await AdbScrcpyClient.pushServer(adb, serverResponse.body as never);

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
      const video = await client.videoStream;
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
      setStatus("mirroring");
    } catch (startError) {
      await closeSession();
      closingRef.current = false;
      setError(friendlyError(startError));
      setStatus("error");
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

  async function applyProxy() {
    const adb = adbRef.current;
    if (!adb) return;
    setProxyBusy(true);
    setProxyFeedback(null);
    try {
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
                appliedProxy ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
              }`}>
                {appliedProxy ? `Activo · ${formatAndroidProxy(appliedProxy)}` : "Red directa"}
              </span>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); void applyProxy(); }} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
              <input
                value={proxyHost}
                onChange={(event) => setProxyHost(event.target.value)}
                placeholder="proxy.ejemplo.com"
                aria-label="Host del proxy"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              <input
                value={proxyPort}
                onChange={(event) => setProxyPort(event.target.value)}
                placeholder="8080"
                aria-label="Puerto del proxy"
                inputMode="numeric"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              />
              <button
                type="submit"
                disabled={proxyBusy || !proxyHost.trim() || !proxyPort.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                {proxyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Aplicar
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
