"use client";

/**
 * Pantalla del comensal — Mesa Colectiva.
 *  - Sin ?code: el anfitrión crea la mesa (tras escanear el QR del local) y se
 *    le muestra el QR de mesa para que se unan los demás.
 *  - Con ?code=XXXX: el comensal se une a esa mesa.
 * Muestra el indicador de ahorro en € en vivo + checklist + botones de aporte.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { customerAuthHeaders } from "@/app/bubui/lib/customerAuth";

type State = {
  pctNow: number;
  pctNextVisit: number;
  maxPotentialPct: number;
  diners: number;
  everyonePaidEntry: boolean;
  pendingContributors: number;
  steps: { key: string; label: string; pct: number; euros: number; done: boolean }[];
  euros: { ticket: number; savedNow: number; savedNextVisit: number; maxSaving: number; payNow: number; leftOnTable: number } | null;
};

function getCustomer(): { customerId: string } | null {
  try {
    const raw = localStorage.getItem("bubui.customer");
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c?.customerId ? { customerId: c.customerId } : null;
  } catch {
    return null;
  }
}

function MesaInner() {
  const sp = useSearchParams();
  const code = (sp.get("code") || "").toUpperCase();
  const businessId = sp.get("businessId") || "";
  const ticketParam = Number(sp.get("ticket") || "") || null;

  const [me] = useState(getCustomer);
  const [activeCode, setActiveCode] = useState(code);
  const [state, setState] = useState<State | null>(null);
  const [biz, setBiz] = useState<{ name?: string; googlePlaceId?: string | null; reviewPlatform?: string; reviewPlatformLabel?: string; reviewUrl?: string | null; perkLabel?: string | null }>({});
  const [ticket, setTicket] = useState<number | null>(ticketParam);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(c: string) {
    const r = await fetch(`/api/bubui/table/${c}${ticket ? `?ticket=${ticket}` : ""}`);
    if (r.ok) {
      const d = await r.json();
      setState(d.state);
      setBiz(d.business ?? {});
    }
  }

  // Unirse automáticamente si llegamos con ?code.
  useEffect(() => {
    if (!code || !me) return;
    (async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/bubui/table/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
          body: JSON.stringify({ customerId: me.customerId, ticketAmount: ticket ?? undefined })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) setErr(d?.error?.message ?? "No se pudo unir a la mesa.");
        else { setActiveCode(code); setState(d.state); }
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, me?.customerId]);

  // Refresco en vivo del estado.
  useEffect(() => {
    if (!activeCode) return;
    refresh(activeCode);
    const i = setInterval(() => refresh(activeCode), 5000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCode, ticket]);

  async function createTable() {
    if (!me || !businessId) { setErr("Escanea primero el QR del restaurante."); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/bubui/table`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
        body: JSON.stringify({ businessId, customerId: me.customerId, ticketAmount: ticket ?? undefined })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d?.error?.message ?? "No se pudo crear la mesa.");
      else { setActiveCode(d.code); setState(d.state); }
    } finally {
      setBusy(false);
    }
  }

  async function contribute(type: "share" | "review" | "photo" | "follow") {
    if (!activeCode || !me) return;
    if (type === "review") {
      const url = biz.reviewUrl || (biz.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${biz.googlePlaceId}` : null);
      if (url) window.open(url, "_blank");
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/bubui/table/${activeCode}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
        body: JSON.stringify({ customerId: me.customerId, type, ticketAmount: ticket ?? undefined })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setState(d.state);
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <div className="p-6 text-center text-sm">Abre Bubui e inicia sesión para usar la Mesa Colectiva.</div>;
  }

  // Anfitrión sin mesa aún → botón crear + (si ya creó) QR de mesa.
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-lg font-black text-center">🍽️ Mesa Colectiva{biz.name ? ` · ${biz.name}` : ""}</h1>
      {err && <p className="text-sm text-rose-600 text-center">{err}</p>}

      {!activeCode && (
        <button onClick={createTable} disabled={busy} className="bubui-btn w-full py-3">
          {busy ? "Creando…" : "Crear mesa y generar QR"}
        </button>
      )}

      {activeCode && (
        <>
          {/* QR para que se unan los demás */}
          <div className="bubui-card p-4 text-center space-y-2">
            <p className="text-xs text-black/60">Que el resto de la mesa escanee este QR:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/bubui/table/${activeCode}/qr.png`} alt="QR de mesa" className="w-44 h-44 mx-auto" />
            <p className="font-mono text-lg font-black tracking-widest">{activeCode}</p>
          </div>

          {/* Indicador de ahorro en € */}
          {state && (
            <div className="bubui-card p-4 space-y-2 text-center">
              {!ticket ? (
                <label className="text-sm">
                  Importe de la cuenta (€):
                  <input
                    type="number"
                    onChange={(e) => setTicket(Number(e.target.value) || null)}
                    className="ml-2 w-24 px-2 py-1 border rounded"
                    placeholder="€"
                  />
                </label>
              ) : (
                <>
                  <p className="text-3xl font-black text-emerald-600">Os ahorráis {state.euros?.savedNow ?? 0}€</p>
                  <p className="text-xs text-black/60">
                    Pagáis {state.euros?.payNow ?? ticket}€ · {state.pctNow}%
                    {(state.euros?.savedNextVisit ?? 0) > 0 && <> · +{state.euros?.savedNextVisit}€ para la próxima visita</>}
                  </p>
                  {(state.euros?.leftOnTable ?? 0) > 0 && (
                    <p className="text-xs font-semibold text-amber-600">⚠️ Os estáis dejando {state.euros?.leftOnTable}€ — completad los pasos de abajo</p>
                  )}
                </>
              )}
              {biz.perkLabel && (
                <p className="text-sm font-semibold text-amber-700">🎁 {biz.perkLabel} para tu próxima visita al completar los pasos</p>
              )}
              <p className="text-xs text-black/50">{state.diners} en la mesa{!state.everyonePaidEntry ? ` · falta${state.pendingContributors === 1 ? "" : "n"} ${state.pendingContributors} por aportar` : " · ¡todos habéis aportado!"}</p>
            </div>
          )}

          {/* Checklist de pasos — mismo desglose que ve el restaurante */}
          {state && (
            <div className="bubui-card p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-black/40">Pasos para subir el descuento</p>
              {state.steps.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1">{s.done ? "✅" : "⬜"} {s.label}</span>
                  <span className={`font-black shrink-0 ${s.done ? "text-emerald-600" : "text-black/40"}`}>
                    {s.key === "quorum" ? "" : "+"}{ticket && s.euros ? `${s.euros}€` : `${s.pct}%`}
                  </span>
                </div>
              ))}
              {(state.euros?.savedNextVisit ?? 0) > 0 && (
                <p className="text-[11px] text-black/45 leading-tight pt-1">
                  💡 ¿No completáis algún paso ahora? Os llega un aviso y el extra queda como <b>cupón para vuestra próxima visita</b>.
                </p>
              )}
            </div>
          )}

          {/* Botones de aporte */}
          <div className="space-y-2">
            <button onClick={() => contribute("share")} disabled={busy} className="bubui-btn w-full py-2.5 text-sm font-bold">
              📤 Invitar amigos a Bubui {state?.steps.find((s) => s.key === "share") ? `(+${ticket && state.steps.find((s) => s.key === "share")?.euros ? `${state.steps.find((s) => s.key === "share")?.euros}€` : `${state.steps.find((s) => s.key === "share")?.pct}%`})` : ""}
            </button>
            <p className="text-[11px] text-black/45 text-center leading-tight -mt-1">Cuenta cuando tu amigo instala la app y se da de alta.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => contribute("review")} disabled={busy} className="bubui-btn py-2 text-xs">⭐ Reseña {biz.reviewPlatformLabel || "Google"}</button>
              <button onClick={() => contribute("follow")} disabled={busy} className="bubui-btn py-2 text-xs">➕ Seguir</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function MesaPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm">Cargando…</div>}>
      <MesaInner />
    </Suspense>
  );
}
