"use client";

/**
 * Pantalla del comensal — Mesa Colectiva (web, espejo de la app nativa).
 *  - Sin ?code: el anfitrión crea la mesa (tras escanear el QR del local) y se
 *    le muestra el QR de mesa para que se unan los demás.
 *  - Con ?code=XXXX: el comensal se une a esa mesa.
 *
 * Modelo de BOTE COMÚN: la mesa desbloquea el descuento al juntar N acciones
 * verificadas (N = comensales), repartibles entre todos. Una acción = una
 * captura (reseña en Google/… o publicación en redes etiquetando al sitio) que
 * valida la IA. Compartir invita amigos (premio de próxima visita), no cuenta
 * para esta visita.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { customerAuthHeaders } from "@/app/bubui/lib/customerAuth";

type State = {
  pctNow: number;
  pctNextVisit: number;
  maxPotentialPct: number;
  diners: number;
  quorum: boolean;
  requiredActions: number;
  verifiedActions: number;
  actionsRemaining: number;
  provisionalActions: number;
  unlocked: boolean;
  steps: { key: string; label: string; pct: number; euros: number; done: boolean }[];
  euros: { ticket: number; savedNow: number; savedNextVisit: number; maxSaving: number; payNow: number; leftOnTable: number } | null;
};

type Biz = {
  name?: string;
  googlePlaceId?: string | null;
  reviewPlatform?: string;
  reviewPlatformLabel?: string;
  reviewUrl?: string | null;
  perkLabel?: string | null;
  actions?: string[];
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
  const [biz, setBiz] = useState<Biz>({});
  const [mine, setMine] = useState<{ reviewVerified: boolean; socialVerified: boolean } | null>(null);
  const [ticket, setTicket] = useState<number | null>(ticketParam);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(c: string) {
    const qs = new URLSearchParams();
    if (me?.customerId) qs.set("me", me.customerId);
    if (ticket) qs.set("ticket", String(ticket));
    const r = await fetch(`/api/bubui/table/${c}?${qs.toString()}`, { headers: customerAuthHeaders() });
    if (r.ok) {
      const d = await r.json();
      setState(d.state);
      setBiz(d.business ?? {});
      setMine(d.me ? { reviewVerified: !!d.me.reviewVerified, socialVerified: !!d.me.socialVerified } : null);
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

  // Invitar amigos (crecimiento): premio = hucha de próxima visita por cada amigo
  // que se da de alta. No cuenta para el descuento de esta visita.
  async function invite() {
    if (!activeCode || !me) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bubui/table/${activeCode}/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...customerAuthHeaders() },
        body: JSON.stringify({ customerId: me.customerId, type: "share", ticketAmount: ticket ?? undefined })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setState(d.state);
    } finally {
      setBusy(false);
    }
  }

  function openReview() {
    const url = biz.reviewUrl || (biz.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${biz.googlePlaceId}` : null);
    if (url) window.open(url, "_blank");
    else setNotice("Este negocio aún no tiene el enlace de reseña configurado.");
  }

  // Sube una captura (reseña o publicación social) → la IA la valida y, si es
  // válida, suma una acción al bote común de la mesa.
  async function uploadAction(type: "review" | "social", file: File) {
    if (!activeCode || !me) return;
    setBusy(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("customerId", me.customerId);
      fd.append("type", type);
      if (ticket) fd.append("ticketAmount", String(ticket));
      fd.append("file", file);
      const r = await fetch(`/api/bubui/table/${activeCode}/verify-action`, {
        method: "POST",
        headers: customerAuthHeaders(),
        body: fd
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error?.message ?? "No se pudo subir la captura.");
      } else {
        setState(d.state);
        setNotice(d.valid ? (d.provisional ? "✓ Recibido — lo verificará el camarero." : "✓ Acción verificada.") : `No validada: ${d.reason}`);
        await refresh(activeCode);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <div className="p-6 text-center text-sm">Abre Bubui e inicia sesión para usar la Mesa Colectiva.</div>;
  }

  const canReview = biz.actions?.includes("review");
  const canSocial = biz.actions?.includes("photo") || biz.actions?.includes("follow");
  const canInvite = biz.actions?.includes("share");
  const heroPct = state ? (state.unlocked ? state.pctNow : state.maxPotentialPct) : 0;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-lg font-black text-center">🍽️ Mesa Colectiva{biz.name ? ` · ${biz.name}` : ""}</h1>
      {err && <p className="text-sm text-rose-600 text-center">{err}</p>}
      {notice && <p className="text-sm text-center text-black/70">{notice}</p>}

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

          {/* Indicador de ahorro / descuento */}
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
                  <p className="text-3xl font-black text-emerald-600">{state.unlocked ? `Os ahorráis ${state.euros?.savedNow ?? 0}€` : `Hasta ${state.euros?.maxSaving ?? 0}€`}</p>
                  <p className="text-xs text-black/60">{state.unlocked ? `Pagáis ${state.euros?.payNow ?? ticket}€ · ${state.pctNow}%` : `${heroPct}% al completar el bote`}</p>
                </>
              )}
              {biz.perkLabel && (
                <p className="text-sm font-semibold text-amber-700">🎁 {biz.perkLabel} para tu próxima visita al completar las acciones</p>
              )}
              <p className="text-xs text-black/50">
                {state.diners} en la mesa ·{" "}
                {state.unlocked
                  ? "✓ descuento desbloqueado"
                  : state.quorum
                    ? `faltan ${state.actionsRemaining} de ${state.requiredActions} acciones`
                    : `sed ${state.requiredActions || 1}+ en la mesa`}
              </p>
            </div>
          )}

          {/* Aviso LLAMATIVO para el camarero (acciones sin validar por la IA). */}
          {state && state.provisionalActions > 0 && (
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-100 p-3 flex items-center gap-3 animate-pulse">
              <span className="text-2xl">⚠️</span>
              <div className="text-left">
                <p className="font-black text-amber-900 text-sm">Camarero: verifica {state.provisionalActions} acción{state.provisionalActions === 1 ? "" : "es"}</p>
                <p className="text-amber-900/90 text-xs leading-tight">No se pudieron validar automáticamente. Comprueba la reseña/publicación antes de aplicar el descuento.</p>
              </div>
            </div>
          )}

          {/* Acciones del bote común (subir captura → valida la IA) */}
          {state && (
            <div className="bubui-card p-4 space-y-3">
              <p className="text-[11px] uppercase tracking-wider font-bold text-black/40">
                Acciones de la mesa {state.unlocked ? "✓" : `${state.verifiedActions}/${state.requiredActions}`}
              </p>
              <p className="text-xs text-black/55 leading-snug">
                Juntad <b>{state.requiredActions} acciones</b> (una por comensal). Es un bote común: cualquiera puede subir <b>de más</b> para cubrir a quien no pueda. Sube la captura y la verificamos al instante.
              </p>

              {canReview && (
                <div className="space-y-1">
                  <p className="text-xs font-bold">⭐ Reseña en {biz.reviewPlatformLabel || "Google"}</p>
                  {!mine?.reviewVerified && (
                    <button onClick={openReview} disabled={busy} className="text-xs font-bold text-rose-600 underline">
                      1 · Abrir {biz.reviewPlatformLabel || "Google"} para dejar la reseña
                    </button>
                  )}
                  <label className={`bubui-btn w-full py-2 text-xs flex items-center justify-center cursor-pointer ${mine?.reviewVerified ? "opacity-60" : ""}`}>
                    {mine?.reviewVerified ? "✓ Reseña verificada" : "2 · Subir captura de la reseña"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy || mine?.reviewVerified}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAction("review", f); e.target.value = ""; }}
                    />
                  </label>
                </div>
              )}

              {canSocial && (
                <div className="space-y-1">
                  <p className="text-xs font-bold">📸 Foto de grupo en tus redes etiquetando a {biz.name || "el restaurante"}</p>
                  <label className={`bubui-btn w-full py-2 text-xs flex items-center justify-center cursor-pointer ${mine?.socialVerified ? "opacity-60" : ""}`}>
                    {mine?.socialVerified ? "✓ Publicación verificada" : "Subir captura de tu publicación"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy || mine?.socialVerified}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAction("social", f); e.target.value = ""; }}
                    />
                  </label>
                </div>
              )}

              {!canReview && !canSocial && <p className="text-xs text-black/45">Este restaurante aún no ha activado acciones.</p>}
            </div>
          )}

          {/* Crece y gana: invitar amigos (hucha de próxima visita) */}
          {canInvite && (
            <div className="bubui-card p-4 space-y-2">
              <p className="text-xs font-bold">📲 Crece y gana</p>
              <p className="text-[11px] text-black/55 leading-tight">
                Aparte del descuento de hoy: invita a tus amigos y por <b>cada uno que se dé de alta</b> sumas % en tu hucha para tu próxima visita.
              </p>
              <button onClick={invite} disabled={busy} className="bubui-btn w-full py-2.5 text-sm font-bold">
                📤 Invitar amigos a Bubui
              </button>
            </div>
          )}

          {/* Checklist de pasos */}
          {state && (
            <div className="bubui-card p-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-black/40">Progreso del grupo</p>
              {state.steps.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1">{s.done ? "✅" : "⬜"} {s.label}</span>
                  {s.pct > 0 && (
                    <span className={`font-black shrink-0 ${s.done ? "text-emerald-600" : "text-black/40"}`}>
                      {ticket && s.euros ? `${s.euros}€` : `${s.pct}%`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
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
