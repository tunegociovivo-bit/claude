"use client";

import { FormEvent, useEffect, useState } from "react";
import VapiPhoneConnectionCard from "@/components/VapiPhoneConnectionCard";

// Panel INTERNO de Negocio Vivo (solo operadores autorizados por
// NV_OPERATOR_EMAILS; si la variable no está configurada, no lo ve nadie).
// Registra una infraestructura ya creada a mano: número puente Twilio Voice +
// recurso en Vapi, asignados a un workspace. Aquí sí hay detalle técnico.

type OperatorRow = {
  workspaceId: string;
  workspaceName: string;
  status: string | null;
  publicE164: string | null;
  bridgeE164: string | null;
  vapiPhoneNumberId: string | null;
  notifyPending: boolean;
  notifyError: string | null;
  lastErrorMessage: string | null;
};

export default function OperatorPhoneCard() {
  const [rows, setRows] = useState<OperatorRow[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const response = await fetch("/api/v1/operator/vapi-phone", { cache: "no-store" });
    if (!response.ok) { setVisible(false); return; } // fail-closed: sin permiso no se muestra nada
    const data = await response.json();
    setRows(data.connections ?? []);
    setVisible(true);
  }
  useEffect(() => { void load(); }, []);

  if (!visible) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/operator/vapi-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: form.get("workspaceId"),
          vapiPhoneNumberId: form.get("vapiPhoneNumberId"),
          bridgeE164: form.get("bridgeE164"),
          publicE164: form.get("publicE164") || undefined,
          label: form.get("label") || undefined,
          configureInbound: form.get("configureInbound") === "on",
          activate: form.get("activate") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la infraestructura");
      setMessage({ kind: "ok", text: "Infraestructura registrada." });
      (event.target as HTMLFormElement).reset();
      await load();
    } catch (cause) {
      setMessage({ kind: "err", text: cause instanceof Error ? cause.message : "No se pudo registrar la infraestructura" });
    } finally { setBusy(false); }
  }

  const pending = (rows ?? []).filter((row) => row.status && row.status !== "ACTIVE");

  return (
    <section className="card space-y-4 border-violet-200 p-6">
      <div>
        <h2 className="font-semibold">🛠 Operador Negocio Vivo — teléfonos</h2>
        <p className="text-xs text-slate-500">Panel interno. Los clientes no ven esta sección.</p>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">Solicitudes y estados</p>
        {(rows ?? []).length === 0 && <p className="text-xs text-slate-500">No hay negocios todavía.</p>}
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {(rows ?? []).map((row) => (
            <button
              key={row.workspaceId}
              type="button"
              onClick={() => setSelected(row.workspaceId)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-xs ${selected === row.workspaceId ? "border-violet-400 bg-violet-50" : "border-slate-200"}`}
            >
              <span className="font-semibold">{row.workspaceName}</span>
              <span className="text-slate-400"> · {row.workspaceId}</span>
              <span className="block text-slate-500">
                {row.status ? `Estado: ${row.status}` : "Sin teléfono"}
                {row.publicE164 ? ` · móvil ${row.publicE164}` : ""}
                {row.bridgeE164 ? ` · puente ${row.bridgeE164}` : ""}
                {row.vapiPhoneNumberId ? ` · vapi ${row.vapiPhoneNumberId}` : ""}
              </span>
              {row.notifyPending && <span className="text-amber-700">⚠ Aviso por email pendiente{row.notifyError ? ` (${row.notifyError})` : ""} — revisar manualmente</span>}
              {row.lastErrorMessage && <span className="block text-red-600">{row.lastErrorMessage}</span>}
            </button>
          ))}
        </div>
        {pending.length > 0 && <p className="text-xs text-amber-700">{pending.length} negocio(s) pendientes de activación.</p>}
      </div>

      <form className="space-y-3 rounded-lg border border-slate-200 p-3" onSubmit={submit}>
        <p className="text-sm font-medium">Registrar infraestructura ya creada</p>
        <p className="text-xs text-slate-500">
          Flujo: comprar número Twilio con Voice (tras compliance ES) → conectarlo en Vapi → pegar aquí el id del recurso.
          Se valida contra Vapi que existe, que su número coincide con el puente y que no está asignado a otro negocio.
          El número protegido de SONIA no se puede seleccionar.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input sm:col-span-2" name="workspaceId" required value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="workspaceId (elige arriba)" />
          <input className="input" name="vapiPhoneNumberId" required autoComplete="off" placeholder="Vapi phoneNumberId" />
          <input className="input" name="bridgeE164" required placeholder="Número puente, p. ej. +34911222333" />
          <input className="input" name="publicE164" placeholder="Móvil del cliente (opcional si ya lo guardó)" />
          <input className="input" name="label" maxLength={40} placeholder="Etiqueta opcional" />
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="configureInbound" defaultChecked /> Apuntar el inbound del número al webhook de este workspace (recomendado)</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="activate" /> Marcar como ACTIVO (solo tras configurar el desvío y probar la llamada)</label>
        {message && <p className={`text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>}
        <button className="btn-primary" disabled={busy} type="submit">{busy ? "Registrando…" : "Registrar"}</button>
      </form>

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Avanzado / interno: importador Twilio del workspace actual (soporte)</summary>
        <p className="mt-2 text-xs text-slate-500">
          Flujo antiguo de autoservicio: intenta importar en Vapi un número que ya sea Active Number de una cuenta Twilio.
          No sirve para móviles de otro operador (SIMYO, etc.); se mantiene solo para soporte.
        </p>
        <div className="mt-2"><VapiPhoneConnectionCard /></div>
      </details>
    </section>
  );
}
