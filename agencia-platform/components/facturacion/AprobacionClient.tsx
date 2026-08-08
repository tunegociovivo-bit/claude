"use client";

import { useEffect, useState } from "react";

type Req = {
  id: string; status: string; companyName: string; clientName: string; invoiceNumber: string | null;
  amountCents: number; currency: string; mandateRef: string | null; ibanMasked: string | null;
  providerStatus: string; tokenExpiresAt: string;
};

function euros(cents: number, cur: string) {
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export default function AprobacionClient({ token }: { token: string }) {
  const [req, setReq] = useState<Req | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"APPROVED" | "REJECTED" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/v1/facturacion/remesas/by-token/${encodeURIComponent(token)}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          setLoadErr(
            j?.reason === "expired" ? "El enlace ha caducado (24 h)." :
            j?.reason === "used" ? "Este enlace ya se usó." :
            j?.reason === "not_pending" ? "La solicitud ya fue decidida." :
            "Solicitud no encontrada."
          );
          return;
        }
        setReq(j.request);
      } finally { setLoading(false); }
    })();
  }, [token]);

  async function decide(action: "approve" | "reject") {
    if (!confirm) { alert("Marca la casilla de confirmación primero."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/facturacion/remesas/by-token/${encodeURIComponent(token)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm: true, reason: action === "reject" ? reason : undefined })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j?.error?.message ?? j?.message ?? "No se pudo completar la acción."); return; }
      setDone(j.status);
    } finally { setBusy(false); }
  }

  if (loading) return <div className="text-slate-400 text-sm">Cargando…</div>;
  if (done) {
    return (
      <div className={"rounded-lg border p-4 " + (done === "APPROVED" ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50")}>
        <div className="font-semibold">{done === "APPROVED" ? "✅ Remesa aprobada" : "🗑 Remesa rechazada"}</div>
        <p className="text-sm text-slate-600 mt-1">
          {done === "APPROVED"
            ? "La solicitud queda lista para preparar en el banco. Recuerda: aprobar NO ha firmado ni ejecutado el cobro."
            : "La solicitud ha sido rechazada. No se realizará ningún cobro."}
        </p>
      </div>
    );
  }
  if (loadErr || !req) return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-800 text-sm">{loadErr ?? "No disponible."}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4 space-y-1.5">
        <Row k="Empresa emisora" v={req.companyName} />
        <Row k="Cliente" v={req.clientName} />
        <Row k="Factura" v={req.invoiceNumber ?? "—"} />
        <Row k="Importe" v={euros(req.amountCents, req.currency)} strong />
        <Row k="Mandato SEPA" v={req.mandateRef ?? "—"} />
        <Row k="IBAN" v={req.ibanMasked ?? "—"} />
        <Row k="Caduca" v={new Date(req.tokenExpiresAt).toLocaleString("es-ES")} />
      </div>

      {req.providerStatus !== "CONFIGURED" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ Integración Santander pendiente de configurar. Aprobar deja la solicitud lista, pero <strong>no</strong> firma ni ejecuta el cobro.
        </div>
      )}

      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Motivo (opcional, para rechazo)" className="w-full rounded border px-2 py-1.5 text-sm" />

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 accent-brand-600" />
        <span>Confirmo que quiero decidir sobre esta remesa. Entiendo que <strong>aprobar no ejecuta el cobro</strong>, solo deja la solicitud lista.</span>
      </label>

      <div className="flex items-center gap-2">
        <button onClick={() => void decide("approve")} disabled={busy || !confirm} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? "…" : "✅ Aprobar"}
        </button>
        <button onClick={() => void decide("reject")} disabled={busy || !confirm} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          🗑 Rechazar
        </button>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className={strong ? "font-bold text-slate-900" : "text-slate-800"}>{v}</span>
    </div>
  );
}
