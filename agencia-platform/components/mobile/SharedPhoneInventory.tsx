"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Link2, Loader2, Plus, RefreshCw, Smartphone } from "lucide-react";
import {
  normalizedPhone,
  sanitizeMobileSessionName,
  type SharedMobilePhone
} from "@/lib/mobile/shared-phones";

type ConnectedDevice = { serial: string; name: string };

type Props = {
  items: SharedMobilePhone[];
  connectedDevices: ConnectedDevice[];
  canManage: boolean;
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
};

function apiMessage(payload: any, fallback: string): string {
  return String(payload?.error?.message || payload?.message || fallback);
}

export default function SharedPhoneInventory({
  items,
  connectedDevices,
  canManage,
  loading,
  error,
  onReload
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function createPhone(event: FormEvent) {
    event.preventDefault();
    if (!sessionName || normalizedPhone(phone).length < 6) return;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/v1/mobile/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionName,
          label: label.trim(),
          phone: phone.trim(),
          deviceSerial: deviceSerial || null
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(payload, "No se ha podido añadir el teléfono"));
      setSessionName("");
      setLabel("");
      setPhone("");
      setDeviceSerial("");
      setShowCreate(false);
      await onReload();
    } catch (createError) {
      setFeedback(createError instanceof Error ? createError.message : "No se ha podido añadir el teléfono");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm" aria-labelledby="shared-phones-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100 bg-indigo-50/60 px-5 py-4">
        <div>
          <h2 id="shared-phones-title" className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Smartphone className="h-5 w-5 text-indigo-700" /> Teléfonos compartidos
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            Este es el mismo inventario que utiliza Leads. Un alta o cambio realizado aquí aparece también en Ajustes de Leads, y los números creados allí aparecen en F - Móviles.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onReload()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => { setShowCreate((value) => !value); setFeedback(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-800"
            >
              <Plus className="h-3.5 w-3.5" /> Añadir número
            </button>
          )}
        </div>
      </header>

      {showCreate && canManage && (
        <form onSubmit={createPhone} className="grid gap-2 border-b bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.2fr_auto]">
          <input
            value={sessionName}
            onChange={(event) => setSessionName(sanitizeMobileSessionName(event.target.value))}
            placeholder="sesión técnica"
            aria-label="Nombre de sesión técnica"
            required
            className="rounded-lg border bg-white px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="etiqueta (opcional)"
            aria-label="Etiqueta del teléfono"
            maxLength={60}
            className="rounded-lg border bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+34600000000"
            aria-label="Número de teléfono"
            inputMode="tel"
            required
            className="rounded-lg border bg-white px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <select
            value={deviceSerial}
            onChange={(event) => setDeviceSerial(event.target.value)}
            aria-label="Android asociado"
            className="min-w-0 rounded-lg border bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Sin Android asociado todavía</option>
            {connectedDevices.map((device) => (
              <option key={device.serial} value={device.serial}>{device.name} · {device.serial}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving || !sessionName || normalizedPhone(phone).length < 6}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
          </button>
        </form>
      )}

      {(error || feedback) && (
        <p role="alert" className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">{feedback || error}</p>
      )}

      <div className="divide-y">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando teléfonos compartidos…
          </div>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Todavía no hay teléfonos en el inventario compartido.</p>
        ) : items.map((item) => (
          <SharedPhoneRow
            key={item.key}
            item={item}
            connectedDevices={connectedDevices}
            canManage={canManage}
            onSaved={onReload}
          />
        ))}
      </div>
    </section>
  );
}

function SharedPhoneRow({
  item,
  connectedDevices,
  canManage,
  onSaved
}: {
  item: SharedMobilePhone;
  connectedDevices: ConnectedDevice[];
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(item.label);
  const [phone, setPhone] = useState(item.phone);
  const [serial, setSerial] = useState(item.deviceSerial ?? "");
  const [active, setActive] = useState(item.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLabel(item.label);
    setPhone(item.phone);
    setSerial(item.deviceSerial ?? "");
    setActive(item.active);
  }, [item]);

  const connected = Boolean(serial && connectedDevices.some((device) => device.serial === serial));

  async function saveRow() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/mobile/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          label: label.trim(),
          phone: phone.trim(),
          deviceSerial: serial || null,
          ...(!item.principal ? { active } : {})
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(payload, "No se han podido guardar los cambios"));
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se han podido guardar los cambios");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 px-5 py-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(16rem,1.4fr)_auto] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-bold text-slate-900">{item.label || item.sessionName}</span>
          {item.principal && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">Principal</span>}
          {item.proxyConfigured && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-800">Proxy de envíos configurado</span>}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">Sesión: {item.sessionName}</p>
      </div>

      {canManage ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-label={`Etiqueta de ${item.sessionName}`}
            maxLength={60}
            disabled={item.principal}
            title={item.principal ? "La etiqueta del número principal es fija" : undefined}
            className="min-w-0 rounded-lg border px-2.5 py-2 text-xs disabled:bg-slate-100 disabled:text-slate-500"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+34600…"
            aria-label={`Número de ${item.sessionName}`}
            inputMode="tel"
            className="min-w-0 rounded-lg border px-2.5 py-2 font-mono text-xs"
          />
        </div>
      ) : (
        <p className="font-mono text-sm text-slate-700">{item.phone || "Número pendiente"}</p>
      )}

      <div className="min-w-0">
        {canManage ? (
          <select
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            aria-label={`Android asociado a ${item.sessionName}`}
            className="w-full min-w-0 rounded-lg border bg-white px-2.5 py-2 text-xs"
          >
            <option value="">Sin Android asociado</option>
            {serial && !connectedDevices.some((device) => device.serial === serial) && (
              <option value={serial}>No conectado · {serial}</option>
            )}
            {connectedDevices.map((device) => (
              <option key={device.serial} value={device.serial}>{device.name} · {device.serial}</option>
            ))}
          </select>
        ) : (
          <p className="truncate font-mono text-xs text-slate-600">{serial || "Sin Android asociado"}</p>
        )}
        <p className={`mt-1 flex items-center gap-1 text-[11px] ${connected ? "text-emerald-700" : "text-slate-500"}`}>
          <Link2 className="h-3 w-3" /> {serial ? (connected ? "Android conectado ahora" : "Android asociado, no conectado") : "Pendiente de asociar"}
        </p>
      </div>

      {canManage && (
        <div className="flex items-center justify-end gap-2">
          {!item.principal && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="accent-emerald-600" /> En uso
            </label>
          )}
          <button
            type="button"
            onClick={() => void saveRow()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-700 xl:col-span-4">{error}</p>}
    </div>
  );
}
