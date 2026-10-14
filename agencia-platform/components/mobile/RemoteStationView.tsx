"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Circle, ExternalLink, Layers, Loader2, Monitor, Type, WifiOff } from "lucide-react";
import MobileAutomationPanel from "@/components/mobile/MobileAutomationPanel";

type StationDevice = {
  key: string; label: string | null; phone: string | null; deviceSerial: string;
  online: boolean; live: boolean; snapshotAt: number | null; width: number | null; height: number | null; working: string | null;
};

async function sendCommand(body: Record<string, unknown>) {
  const response = await fetch("/api/v1/mobile/station/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || "No se ha podido enviar la orden al móvil.");
  }
}

/** Vista para cualquier ordenador sin móviles por USB: ve y controla los móviles de la estación. */
export default function RemoteStationView({ storageScope }: { storageScope: string }) {
  const [devices, setDevices] = useState<StationDevice[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/mobile/station", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || "No se ha podido cargar la estación de móviles.");
      setDevices(Array.isArray(payload?.devices) ? payload.devices : []);
      setCanManage(Boolean(payload?.canManage));
      setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se ha podido cargar la estación de móviles."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer); }, [load]);

  const anyOnline = devices.some((device) => device.online);
  return (
    <section className="space-y-4" aria-label="Móviles de la estación">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
        <p className="flex items-center gap-2 font-bold"><Monitor className="h-4 w-4" /> Acceso remoto a la estación de móviles</p>
        <p>Este ordenador no tiene móviles conectados por USB, así que ves los de la estación: el ordenador donde están enchufados, que debe tener abierta la página Móviles (o el agente de escritorio). Las imágenes se actualizan cada segundo y medio; {canManage ? "toca la pantalla para pulsar, arrastra para deslizar y usa los botones de abajo." : "solo los administradores pueden controlar los móviles."}</p>
        {!loading && devices.length > 0 && !anyOnline && <p className="mt-1 font-semibold text-amber-800">Ahora mismo la estación no está enviando nada: comprueba que el ordenador de los móviles está encendido con la página Móviles abierta.</p>}
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {loading ? <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Cargando móviles…</p>
        : devices.length === 0 ? <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-600">No hay móviles asociados a números compartidos todavía.</p>
        : <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => <RemotePhoneCard key={device.deviceSerial} device={device} canManage={canManage} storageScope={storageScope} />)}
          </div>}
    </section>
  );
}

function RemotePhoneCard({ device, canManage, storageScope }: { device: StationDevice; canManage: boolean; storageScope: string }) {
  const [tick, setTick] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 1_500); return () => window.clearInterval(timer); }, []);

  const run = async (body: Record<string, unknown>, done = "Orden enviada. La pantalla se actualizará en un momento.") => {
    try { await sendCommand({ deviceSerial: device.deviceSerial, ...body }); setNote(done); }
    catch (error) { setNote(error instanceof Error ? error.message : "No se ha podido enviar la orden."); }
  };

  const toVideo = (event: ReactPointerEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = device.width ?? event.currentTarget.naturalWidth;
    const height = device.height ?? event.currentTarget.naturalHeight;
    return {
      x: Math.max(0, Math.min(width - 1, Math.round((event.clientX - rect.left) / rect.width * width))),
      y: Math.max(0, Math.min(height - 1, Math.round((event.clientY - rect.top) / rect.height * height)))
    };
  };

  const onDown = (event: ReactPointerEvent<HTMLImageElement>) => { if (!canManage) return; event.preventDefault(); start.current = { ...toVideo(event), t: Date.now() }; };
  const onUp = (event: ReactPointerEvent<HTMLImageElement>) => {
    const from = start.current; start.current = null;
    if (!canManage || !from) return;
    const to = toVideo(event);
    const scale = (device.width ?? 1000) / Math.max(1, event.currentTarget.getBoundingClientRect().width);
    if (Math.hypot(to.x - from.x, to.y - from.y) > 12 * scale) void run({ type: "swipe", x: from.x, y: from.y, x2: to.x, y2: to.y });
    else void run({ type: "tap", x: from.x, y: from.y });
  };

  const busy = device.working === "working" || device.working === "recovering";
  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-slate-900">{device.phone || device.label || "Android"}</h2>
          <p className="truncate text-[11px] text-slate-500">{device.label || device.deviceSerial}</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${!device.online ? "bg-slate-200 text-slate-700" : busy ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {device.online ? <Circle className="h-2.5 w-2.5 fill-current" /> : <WifiOff className="h-3 w-3" />}
          {!device.online ? "Desconectado" : busy ? "Publicando" : "Conectado"}
        </span>
      </header>
      <div className="flex justify-center bg-slate-900 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/v1/mobile/station/snapshot?serial=${encodeURIComponent(device.deviceSerial)}&t=${tick}`}
          alt={`Pantalla de ${device.phone || "móvil"}`}
          draggable={false}
          onLoad={() => setImageOk(true)}
          onError={() => setImageOk(false)}
          onPointerDown={onDown}
          onPointerUp={onUp}
          className={`max-h-[560px] w-auto select-none rounded-lg ${canManage ? "cursor-pointer" : ""} ${imageOk ? "" : "hidden"}`}
          style={{ touchAction: "none" }}
        />
        {!imageOk && <p className="py-24 text-center text-xs text-slate-300">Sin imagen todavía.<br />La estación la enviará en cuanto abra la pantalla de este móvil.</p>}
      </div>
      {canManage && (
        <div className="space-y-2 p-3">
          <div className="grid grid-cols-5 gap-1.5">
            <RemoteButton label="Atrás" onClick={() => run({ type: "back" })}><ArrowLeft className="h-4 w-4" /></RemoteButton>
            <RemoteButton label="Inicio" onClick={() => run({ type: "home" })}><Circle className="h-4 w-4" /></RemoteButton>
            <RemoteButton label="Recientes" onClick={() => run({ type: "recents" })}><Layers className="h-4 w-4" /></RemoteButton>
            <RemoteButton label="Escribir" onClick={() => { const text = window.prompt("Texto a pegar en el campo seleccionado del móvil:"); if (text?.trim()) void run({ type: "text", text: text.slice(0, 2000) }); }}><Type className="h-4 w-4" /></RemoteButton>
            <RemoteButton label="Enlace" onClick={() => { const url = window.prompt("Enlace https que abrirá el móvil:"); if (url?.trim()) void run({ type: "openUrl", url: url.trim() }); }}><ExternalLink className="h-4 w-4" /></RemoteButton>
          </div>
          {busy && <p className="text-[11px] text-amber-800">Este móvil está publicando: las órdenes manuales se ignoran hasta que termine.</p>}
          {note && <p role="status" className="text-[11px] text-slate-600">{note}</p>}
        </div>
      )}
      <details className="border-t">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-slate-700">Automatizaciones de este móvil</summary>
        <div className="px-2 pb-2">
          <MobileAutomationPanel
            reviewStorageScope={storageScope}
            deviceSerial={device.deviceSerial}
            phoneKey={device.key}
            ready={false}
            onExecuteJob={async () => { throw new Error("Los encargos los ejecuta el ordenador de la estación."); }}
            onPasteText={async (text) => { await sendCommand({ deviceSerial: device.deviceSerial, type: "text", text: text.slice(0, 2000) }); }}
          />
          <p className="px-1 pt-1 text-[11px] text-slate-500">Los encargos que crees aquí quedan en cola y los publica la estación automáticamente.</p>
        </div>
      </details>
    </article>
  );
}

function RemoteButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} title={label} className="inline-flex flex-col items-center gap-0.5 rounded-lg border bg-slate-50 px-1 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100">{children}{label}</button>;
}
