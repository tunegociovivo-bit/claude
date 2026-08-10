"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAgentName } from "@/components/AgentNameContext";

// Tarjeta comercial del teléfono: el cliente solo indica su móvil público.
// Sin credenciales ni jerga técnica; la infraestructura la monta Negocio Vivo.

type Connection = {
  status: string;
  publicE164: string | null;
  e164: string | null;
  label: string | null;
  infrastructureReady: boolean;
  lastErrorMessage: string | null;
  releasable?: boolean;
  notifyPending?: boolean;
};

type Commercial = "NONE" | "PENDING" | "ACTIVE" | "REVIEW";

function commercialState(connection: Connection | null): Commercial {
  if (!connection) return "NONE";
  if (connection.status === "ACTIVE") return "ACTIVE";
  if (connection.status === "FAILED") return "REVIEW";
  return "PENDING"; // REQUESTED / PENDING / PROVISIONING
}

const BADGE: Record<Commercial, { text: string; className: string }> = {
  NONE: { text: "Sin configurar", className: "bg-slate-100 text-slate-600" },
  PENDING: { text: "Pendiente de activación", className: "bg-amber-100 text-amber-800" },
  ACTIVE: { text: "Activo", className: "bg-emerald-100 text-emerald-800" },
  REVIEW: { text: "Requiere revisión", className: "bg-red-100 text-red-700" },
};

function Step({ done, active, title, detail }: { done: boolean; active?: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500 text-white" : active ? "bg-amber-400 text-white" : "bg-slate-200 text-slate-500"}`}>
        {done ? "✓" : "•"}
      </span>
      <span>
        <span className={`block text-sm ${done ? "text-slate-700" : "font-medium"}`}>{title}</span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </li>
  );
}

export default function BusinessPhoneCard() {
  const agentName = useAgentName();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);

  async function load() {
    const response = await fetch("/api/v1/settings/business-phone", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setConnection(data.connection);
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/settings/business-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: form.get("phoneNumber"), label: form.get("label") || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el teléfono");
      setConnection(data.connection); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el teléfono"); await load(); }
    finally { setBusy(false); }
  }

  // Un intento fallido sin recursos creados se libera con el endpoint ya
  // existente; después el cliente vuelve al formulario normal.
  async function release() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/settings/vapi-phone", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo liberar el intento");
      setConfirmRelease(false); setConnection(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo liberar el intento"); await load(); }
    finally { setBusy(false); }
  }

  const state = commercialState(connection);
  const badge = BADGE[state];
  const showForm = loaded && (state === "NONE" || editing);

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Teléfono del negocio</p>
          <p className="text-xs text-slate-500">
            Tu número de siempre. <b>Conservas tu SIM y tu WhatsApp</b>: solo dinos qué número usas con tus clientes y Negocio Vivo prepara el resto.
          </p>
        </div>
        {loaded && <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.text}</span>}
      </div>

      {state === "REVIEW" && connection && (
        <div className="mt-3 space-y-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <p>
            {connection.releasable
              ? "El intento anterior no llegó a completarse. Puedes corregir el número y volver a guardarlo."
              : "Tu solicitud necesita una comprobación de Negocio Vivo. Nos ponemos con ello; no tienes que hacer nada."}
          </p>
          {connection.releasable && (confirmRelease
            ? <div className="flex flex-wrap items-center gap-2"><span>Se borrará el intento fallido y volverás al formulario.</span><button type="button" className="btn-primary" disabled={busy} onClick={release}>{busy ? "Borrando…" : "Sí, continuar"}</button><button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmRelease(false)}>Cancelar</button></div>
            : <button type="button" className="btn-primary" onClick={() => setConfirmRelease(true)}>Corregir y volver a intentar</button>)}
        </div>
      )}

      {(state === "PENDING" || state === "ACTIVE") && connection && !editing && (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Número del negocio: <b>{connection.publicE164 || connection.e164}</b>
            {connection.label ? <span className="text-slate-500"> · {connection.label}</span> : null}
          </p>
          <ol className="space-y-2 rounded-md bg-slate-50 p-3">
            <Step done title="Tu número está guardado" detail="Negocio Vivo ya sabe qué número hay que activar." />
            <Step
              done={connection.infrastructureReady}
              active={!connection.infrastructureReady}
              title="Negocio Vivo prepara tu línea de llamadas"
              detail={connection.infrastructureReady ? `La línea para ${agentName} ya está creada.` : `Estamos creando la línea que atenderá ${agentName}. Te avisaremos.`}
            />
            <Step
              done={state === "ACTIVE"}
              active={connection.infrastructureReady && state !== "ACTIVE"}
              title="Activar el desvío y probar juntos"
              detail={state === "ACTIVE" ? `${agentName} ya atiende las llamadas de tu número.` : "Cuando la línea esté lista te guiamos para activar el desvío desde tu móvil y hacemos una llamada de prueba."}
            />
          </ol>
          {state === "ACTIVE" && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Todo listo: las llamadas a tu número las atiende {agentName} y tu WhatsApp sigue en tu móvil de siempre.</p>}
          <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(true)}>Cambiar el número</button>
        </div>
      )}

      {showForm && (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input sm:col-span-2" name="phoneNumber" required defaultValue={connection?.publicE164 || ""} placeholder="Tu número con prefijo, p. ej. +34611222333" />
            <input className="input sm:col-span-2" name="label" maxLength={40} defaultValue={connection?.label || ""} placeholder="Nombre opcional (p. ej. Clínica Centro)" />
          </div>
          <p className="text-xs text-slate-500">No necesitas contratar nada ni dar contraseñas: guardas tu número y nosotros nos encargamos del resto. Tu SIM y tu WhatsApp no cambian.</p>
          <div className="flex items-center gap-2">
            <button className="btn-primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar mi número"}</button>
            {editing && <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancelar</button>}
          </div>
        </form>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
