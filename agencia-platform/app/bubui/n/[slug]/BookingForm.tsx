"use client";

/** Formulario de solicitud de cita en la ficha pública de un comercio de
 *  servicios. Crea una cita "pendiente"; el comercio la confirma desde su panel. */
import { useState } from "react";

type Service = { id: string; name: string; durationMin: number; unit?: string | null; priceEur: number | null };

export default function BookingForm({ businessId, services }: { businessId: string; services: Service[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!name.trim() || !phone.trim() || !when) { setMsg("Rellena nombre, teléfono y fecha."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/bubui/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          serviceId: serviceId || null,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          startsAt: new Date(when).toISOString(),
          notes: notes.trim() || null
        })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setDone(true);
      else setMsg(d?.error?.message ?? "No se pudo pedir la cita.");
    } catch {
      setMsg("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="text-sm text-emerald-700">✅ ¡Solicitud enviada! El negocio confirmará tu cita en breve.</p>;
  }

  return (
    <div className="space-y-2">
      {services.length > 0 && (
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full px-3 py-2 border rounded bg-white text-sm">
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.priceEur != null ? ` · ${s.priceEur}€` : ""} ({s.unit && s.unit.trim() ? s.unit : `${s.durationMin} min`})</option>
          ))}
        </select>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" className="px-3 py-2 border rounded bg-white text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono" className="px-3 py-2 border rounded bg-white text-sm" />
      </div>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full px-3 py-2 border rounded bg-white text-sm" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comentario (opcional)" className="w-full px-3 py-2 border rounded bg-white text-sm" />
      {msg && <p className="text-xs text-rose-600">{msg}</p>}
      <button onClick={submit} disabled={busy} className="bubui-btn w-full text-sm py-2.5 disabled:opacity-50">
        {busy ? "Enviando…" : "Pedir cita"}
      </button>
    </div>
  );
}
