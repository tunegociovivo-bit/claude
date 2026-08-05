"use client";

import { FormEvent, useEffect, useState } from "react";

type Connection = { status: string; e164: string | null; label: string | null; lastErrorMessage: string | null };

export default function VapiPhoneConnectionCard() {
  const [enabled, setEnabled] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [mode, setMode] = useState<"PURCHASED" | "IMPORTED">("IMPORTED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/v1/settings/vapi-phone", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setEnabled(Boolean(data.enabled));
    setConnection(data.connection);
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = mode === "PURCHASED"
      ? { mode, areaCode: form.get("areaCode"), label: form.get("label") || undefined }
      : { mode, providerKind: "twilio", phoneNumber: form.get("phoneNumber"), twilioAccountSid: form.get("twilioAccountSid"), twilioAuthToken: form.get("twilioAuthToken"), label: form.get("label") || undefined };
    try {
      const response = await fetch("/api/v1/settings/vapi-phone", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo configurar el número");
      setConnection(data.connection); (event.target as HTMLFormElement).reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo configurar el número"); await load(); }
    finally { setBusy(false); }
  }

  return <div className="rounded-lg border border-slate-200 p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Número de teléfono del negocio</p><p className="text-xs text-slate-500">Un número por negocio, administrado desde la cuenta de Negocio Vivo.</p></div>{connection && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{connection.status}</span>}</div>
    {!enabled && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">La conexión automática está pendiente de activación por Negocio Vivo.</p>}
    {connection?.status === "ACTIVE" ? <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Número conectado: <b>{connection.e164 || connection.label || "Vapi"}</b>. Las llamadas entrantes ya usan SONIA.</div> : connection?.status === "FAILED" ?
      <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">El intento necesita revisión de Negocio Vivo antes de volver a ejecutarse.{connection.lastErrorMessage ? ` Detalle: ${connection.lastErrorMessage}` : ""}</p> : enabled ?
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div className="flex gap-2"><button type="button" className={mode === "IMPORTED" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("IMPORTED")}>Importar mi número</button><button type="button" className={mode === "PURCHASED" ? "btn-primary" : "btn-ghost"} onClick={() => setMode("PURCHASED")}>Comprar número</button></div>
        <input className="input" name="label" maxLength={40} placeholder="Nombre opcional (p. ej. Clínica Centro)" />
        {mode === "PURCHASED" ? <><p className="text-xs text-slate-500">La compra automática de Vapi ofrece números de Estados Unidos. Para España, importa un número de Twilio.</p><input className="input" name="areaCode" inputMode="numeric" pattern="[0-9]{3}" required placeholder="Prefijo de EE. UU. (p. ej. 415)" /></> :
          <div className="grid gap-3 sm:grid-cols-2"><input className="input sm:col-span-2" name="phoneNumber" required placeholder="Número internacional, p. ej. +34911222333" /><input className="input" name="twilioAccountSid" required autoComplete="off" placeholder="Twilio Account SID" /><input className="input" name="twilioAuthToken" type="password" required autoComplete="new-password" placeholder="Twilio Auth Token" /><p className="text-xs text-slate-500 sm:col-span-2">Las credenciales de Twilio se usan para importar el número y no se guardan.</p></div>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy} type="submit">{busy ? "Configurando…" : "Conectar número"}</button>
      </form> : null}
  </div>;
}
