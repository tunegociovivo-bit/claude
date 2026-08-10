"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ExternalLink, Unlink } from "lucide-react";

type Status = { configured: boolean; connected: boolean; googleEmail: string | null };

export default function GoogleCalendarCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/v1/settings/google-calendar", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (response.ok) setStatus(data);
  }
  useEffect(() => { void load(); }, []);

  async function connect() {
    setBusy(true); setError("");
    const response = await fetch("/api/v1/settings/google-calendar", { method: "POST" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.authUrl) {
      setError(data?.error || "No se pudo iniciar la conexión"); setBusy(false); return;
    }
    window.location.href = data.authUrl;
  }

  async function disconnect() {
    if (!window.confirm("¿Desvincular Google Calendar? Las citas ya creadas permanecerán en Google.")) return;
    setBusy(true); setError("");
    const response = await fetch("/api/v1/settings/google-calendar", { method: "DELETE" });
    setBusy(false);
    if (!response.ok) { setError("No se pudo desvincular"); return; }
    await load();
  }

  return (
    <section className="card space-y-4 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><CalendarDays size={21} /></div>
        <div><h2 className="font-semibold">Google Calendar</h2><p className="text-xs text-slate-500">Sincroniza automáticamente las citas del CRM con el calendario del negocio.</p></div>
      </div>
      {!status ? <p className="text-sm text-slate-500">Comprobando conexión…</p> : status.connected ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center">
          <CheckCircle2 className="shrink-0 text-emerald-600" size={21} />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-emerald-900">Calendario conectado</p><p className="truncate text-xs text-emerald-700">{status.googleEmail || "Cuenta de Google autorizada"}</p></div>
          <button className="btn-ghost text-red-600" disabled={busy} onClick={disconnect}><Unlink className="mr-1 inline" size={15} />Desvincular</button>
        </div>
      ) : (
        <div>
          <button className="btn-primary" disabled={busy || !status.configured} onClick={connect}>{busy ? "Conectando…" : <><ExternalLink className="mr-1 inline" size={15} />Conectar Google Calendar</>}</button>
          {!status.configured && <p className="mt-2 text-xs text-amber-700">La integración está pendiente de activación por Negocio Vivo.</p>}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-slate-500">Se sincronizan las citas futuras y los cambios realizados desde el CRM. Cada cliente conecta únicamente su propia cuenta.</p>
    </section>
  );
}
