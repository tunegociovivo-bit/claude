"use client";

/**
 * Asistente de vinculación de Google Business Profile — como en Make.
 * 1) Cuenta de Google: elige una ya conectada o «Añadir cuenta de Google» e inicia sesión con la
 *    cuenta del cliente (sin invitar a la agencia como gestora).
 * 2) Elegir cuenta de Perfil de Empresa + fichas. 3) Confirmación (+ automatización de reseñas).
 *
 * Mientras Google no apruebe el acceso directo del proyecto del Hub a las APIs de Perfiles de
 * Empresa, la conexión se hace con la app de Google de Make (ya aprobada). Todo sale de
 * /api/v1/gmb/google/*: nunca simula estar conectado.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, Search, Check, ChevronLeft, RefreshCw, MapPin, ShieldAlert, ExternalLink, Plus } from "lucide-react";

type Status = {
  ok: boolean;
  configured: boolean;
  setup: { issue: "server" | "google_credentials"; isAdmin: boolean; redirectUri?: string } | null;
};
type Source = { source: string; kind: "hub" | "make"; email: string; label: string; linked: number; revoked?: boolean };
type Sources = { sources: Source[]; direct: { configured: boolean; approved: boolean; error: string | null }; make: { available: boolean } };
type Account = { accountId: string; name?: string; type?: string; role?: string; state?: string };
type Location = {
  locationId: string;
  title?: string;
  address?: string | null;
  phone?: string | null;
  websiteUri?: string | null;
  primaryCategory?: string | null;
  placeId?: string | null;
  linked?: boolean;
};
type Result = { created: number; updated: number; total: number; automation?: { name: string; ok: boolean; scenarioId?: number; error?: string }[] };

const CONNECT_URL = "/api/integrations/gmb-google/connect";

export default function GbpConnectWizard({
  open,
  onClose,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  onLinked?: () => void;
  initialStep?: 1 | 2;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [status, setStatus] = useState<Status | null>(null);
  const [src, setSrc] = useState<Sources | null>(null);
  const [srcErr, setSrcErr] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [adding, setAdding] = useState<{ url: string; before: string[]; mode: "link" | "manual" } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [locsErr, setLocsErr] = useState<string | null>(null);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [automate, setAutomate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSources = useCallback(async () => {
    setSrcErr(null);
    try {
      const [st, so] = await Promise.all([
        fetch("/api/v1/gmb/google/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/v1/gmb/google/sources", { cache: "no-store" }).then((r) => r.json())
      ]);
      setStatus(st);
      if (!so?.ok) throw new Error(so?.error?.message || "No se pudieron cargar las cuentas de Google.");
      setSrc(so);
      return so as Sources;
    } catch (e: any) {
      setSrcErr(e.message || "No se pudieron cargar las cuentas de Google.");
      setSrc({ sources: [], direct: { configured: false, approved: false, error: null }, make: { available: false } });
      return null;
    }
  }, []);

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  useEffect(() => {
    if (!open) {
      stopPoll();
      return;
    }
    setStep(1);
    setResult(null);
    setSource(null);
    setAdding(null);
    setSrc(null);
    loadSources();
    return stopPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadAccounts = useCallback(async (s: Source) => {
    setAccountsErr(null);
    setAccounts(null);
    setAccount(null);
    try {
      const r = await fetch(`/api/v1/gmb/google/accounts?source=${encodeURIComponent(s.source)}`, { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) {
        setAccountsErr(d.message || "No se pudieron cargar las cuentas de Perfil de Empresa.");
        setAccounts([]);
        return;
      }
      setAccounts(d.accounts ?? []);
      if ((d.accounts ?? []).length === 1) setAccount(d.accounts[0].accountId);
    } catch {
      setAccountsErr("No se pudieron cargar las cuentas de Perfil de Empresa.");
      setAccounts([]);
    }
  }, []);

  function pick(s: Source) {
    stopPoll();
    setAdding(null);
    setSource(s);
    setStep(2);
    loadAccounts(s);
  }

  /** «Añadir cuenta de Google»: OAuth del Hub si Google lo aprobó; si no, conexión con Make. */
  async function addAccount() {
    if (src?.direct.approved) {
      window.location.href = CONNECT_URL;
      return;
    }
    setAddBusy(true);
    setSrcErr(null);
    try {
      const r = await fetch("/api/v1/gmb/google/make-connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error?.message || d?.message || "No se pudo iniciar la conexión.");
      const before = (src?.sources ?? []).map((x) => x.source);
      setAdding({ url: d.url, before, mode: d.mode === "manual" ? "manual" : "link" });
      window.open(d.url, "_blank", "noopener");
      // Espera a que aparezca la nueva cuenta (hasta 10 minutos).
      stopPoll();
      let n = 0;
      poll.current = setInterval(async () => {
        if (++n > 120) return stopPoll();
        const so = await fetch("/api/v1/gmb/google/sources", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
        if (!so?.ok) return;
        setSrc(so);
        const fresh = (so.sources as Source[]).find((x) => !before.includes(x.source));
        if (fresh) pick(fresh);
      }, 5000);
    } catch (e: any) {
      setSrcErr(e.message);
    } finally {
      setAddBusy(false);
    }
  }

  // Al seleccionar cuenta de Perfil de Empresa, carga sus ubicaciones reales.
  useEffect(() => {
    if (step !== 2 || !account || !source) return;
    setLoadingLocs(true);
    setLocsErr(null);
    setLocations(null);
    setSelected(new Set());
    (async () => {
      try {
        const r = await fetch(`/api/v1/gmb/google/locations?accountId=${encodeURIComponent(account)}&source=${encodeURIComponent(source.source)}`, { cache: "no-store" });
        const d = await r.json();
        if (!d.ok) {
          setLocsErr(d.message || "No se pudieron cargar las ubicaciones.");
          setLocations([]);
          return;
        }
        setLocations(d.locations ?? []);
      } catch {
        setLocsErr("No se pudieron cargar las ubicaciones.");
        setLocations([]);
      } finally {
        setLoadingLocs(false);
      }
    })();
  }, [step, account, source]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = locations ?? [];
    if (!q) return list;
    return list.filter((l) => `${l.title ?? ""} ${l.address ?? ""} ${l.primaryCategory ?? ""}`.toLowerCase().includes(q));
  }, [locations, search]);

  const selectableIds = useMemo(() => filtered.map((l) => l.locationId), [filtered]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function connectSelected() {
    if (!account || !source || selected.size === 0) return;
    setBusy(true);
    try {
      const chosen = (locations ?? []).filter((l) => selected.has(l.locationId));
      const r = await fetch("/api/v1/gmb/google/connect-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account, source: source.source, automate, locations: chosen })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setLocsErr(d?.error?.message || d.message || "No se pudieron vincular las fichas.");
        return;
      }
      setResult({ created: d.created ?? 0, updated: d.updated ?? 0, total: d.total ?? chosen.length, automation: d.automation ?? [] });
      setStep(3);
      onLinked?.();
    } catch {
      setLocsErr("No se pudieron vincular las fichas.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const setupMissing = src && !src.make.available && status && !status.configured;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <GoogleGlyph />
            <div className="font-semibold text-sm">Conectar fichas de Google Business Profile</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Steps step={step} />

        <div className="px-5 py-5">
          {/* ───────── Paso 1: cuenta de Google ───────── */}
          {step === 1 && (
            <div>
              {!src ? (
                <Loading label="Cargando cuentas de Google…" />
              ) : setupMissing ? (
                <SetupNotice setup={status?.setup ?? null} />
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-3">
                    Elige la cuenta de Google que tiene las fichas o añade una nueva iniciando sesión con la cuenta del cliente.
                    No hace falta dar acceso a tu correo en las fichas.
                  </p>
                  {src.sources.length > 0 && (
                    <div className="text-[12px] font-medium text-slate-600 mb-1.5">Pulsa una cuenta para ver y vincular sus fichas:</div>
                  )}
                  {src.sources.length > 0 && (
                    <div className="border rounded-lg divide-y mb-3">
                      {src.sources.map((s) => (
                        <button key={s.source} onClick={() => pick(s)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                          <GoogleGlyph />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{s.email || s.label}</span>
                            <span className="text-[11px] text-slate-500">
                              {s.linked > 0 ? `${s.linked} ficha${s.linked === 1 ? "" : "s"} vinculada${s.linked === 1 ? "" : "s"}` : "Sin fichas vinculadas"}
                            </span>
                          </span>
                          <span className={"text-[10px] px-2 py-0.5 rounded-full " + (s.kind === "hub" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700")}>
                            {s.kind === "hub" ? "Directa" : "vía Make"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={addAccount}
                    disabled={addBusy || (!src.direct.approved && !src.make.available)}
                    className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Añadir cuenta de Google
                  </button>
                  {adding && (
                    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-[13px] text-violet-900">
                      <div className="flex items-center gap-2 font-medium mb-1">
                        <Loader2 className="h-4 w-4 animate-spin" /> Esperando a que conectes la cuenta…
                      </div>
                      {adding.mode === "manual" ? (
                        <ol className="list-decimal ml-4 my-1 space-y-0.5">
                          <li>En la pestaña de Make que se ha abierto pulsa <b>Crear conexión</b>.</li>
                          <li>Elige <b>Google Business Profile</b> y ponle de nombre el email del cliente.</li>
                          <li>Pulsa <b>Iniciar sesión con Google</b>, elige la cuenta del cliente y acepta los permisos.</li>
                        </ol>
                      ) : (
                        <>En la pestaña que se ha abierto pulsa <b>Conectar</b>, elige la cuenta de Google del cliente y acepta los permisos. </>
                      )}
                      Esta ventana continuará sola en cuanto aparezca la cuenta.{" "}
                      <a href={adding.url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
                        Abrir de nuevo <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  {srcErr && <div className="mt-3"><ErrorBox message={srcErr} onRetry={loadSources} /></div>}
                  <p className="text-[11px] text-slate-400 mt-3">
                    {src.direct.approved
                      ? "Conexión directa con Google (permiso business.manage). Tus credenciales nunca pasan por aquí."
                      : "La conexión se hace con la app de Google de Make mientras Google aprueba el acceso directo del Hub. Tus credenciales nunca pasan por aquí."}
                  </p>
                </>
              )}
            </div>
          )}

          {/* ───────── Paso 2: cuenta de Perfil de Empresa + fichas ───────── */}
          {step === 2 && source && (
            <div>
              <div className="mb-3 flex items-center justify-between text-[12px] text-slate-500">
                <span>
                  Cuenta de Google: <span className="font-medium text-slate-700">{source.email || source.label}</span>
                </span>
                <button onClick={() => { setStep(1); loadSources(); }} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <ChevronLeft className="h-3.5 w-3.5" /> Cambiar
                </button>
              </div>

              {!accounts ? (
                <Loading label="Cargando cuentas de Perfil de Empresa…" />
              ) : accountsErr ? (
                <ErrorBox message={accountsErr} onRetry={() => loadAccounts(source)} />
              ) : accounts.length === 0 ? (
                <div className="text-sm text-slate-500">Esta cuenta de Google no gestiona ningún Perfil de Empresa.</div>
              ) : (
                <>
                  {accounts.length > 1 && (
                    <div className="mb-4">
                      <label className="block text-[12px] font-medium text-slate-600 mb-1">Cuenta de Perfil de Empresa</label>
                      <select value={account ?? ""} onChange={(e) => setAccount(e.target.value || null)} className="w-full border rounded-lg px-3 py-2 text-sm">
                        <option value="">Elige una cuenta…</option>
                        {accounts.map((a) => (
                          <option key={a.accountId} value={a.accountId}>
                            {a.name || a.accountId} {a.type === "PERSONAL" ? "· personal" : a.type ? `· ${a.type.toLowerCase().replace("_", " ")}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {account && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ficha por nombre o dirección…" className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm" />
                        </div>
                        {filtered.length > 0 && (
                          <button onClick={toggleAll} className="text-[12px] text-brand-600 hover:underline whitespace-nowrap">
                            {allSelected ? "Quitar todo" : "Todo"}
                          </button>
                        )}
                      </div>

                      {loadingLocs ? (
                        <Loading label="Cargando fichas…" />
                      ) : locsErr ? (
                        <ErrorBox message={locsErr} onRetry={() => setAccount((a) => (a ? `${a}` : a))} />
                      ) : (locations ?? []).length === 0 ? (
                        <div className="text-sm text-slate-500 py-4">Esta cuenta no tiene fichas.</div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                          {filtered.map((l) => {
                            const on = selected.has(l.locationId);
                            return (
                              <button key={l.locationId} onClick={() => toggle(l.locationId)} className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                                <span className={"mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 " + (on ? "bg-brand-600 border-brand-600" : "border-slate-300")}>
                                  {on && <Check className="h-3 w-3 text-white" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium truncate">{l.title || "Sin nombre"}</span>
                                  {l.address && (
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
                                      <MapPin className="h-3 w-3 shrink-0" /> {l.address}
                                    </span>
                                  )}
                                  {l.primaryCategory && <span className="text-[11px] text-slate-400">{l.primaryCategory}</span>}
                                </span>
                                {l.linked && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Vinculada</span>}
                              </button>
                            );
                          })}
                          {filtered.length === 0 && <div className="px-3 py-4 text-sm text-slate-400">Sin resultados para «{search}».</div>}
                        </div>
                      )}
                      <label className="mt-3 flex items-start gap-2 text-[12px] text-slate-600">
                        <input type="checkbox" checked={automate} onChange={(e) => setAutomate(e.target.checked)} className="mt-0.5" />
                        <span>
                          <b>Activar la automatización de reseñas</b> (Make): las reseñas nuevas entran solas en el Hub y se preparan las respuestas.
                        </span>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ───────── Paso 3: confirmación ───────── */}
          {step === 3 && result && (
            <div className="text-center py-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="font-semibold text-sm mb-1">Fichas vinculadas</div>
              <p className="text-sm text-slate-600">
                {result.created > 0 && <>Se crearon <b>{result.created}</b> fichas nuevas. </>}
                {result.updated > 0 && <>Se actualizaron <b>{result.updated}</b> ya existentes. </>}
                {result.created === 0 && result.updated === 0 && <>No hubo cambios.</>}
              </p>
              {!!result.automation?.length && (
                <ul className="mt-3 text-left text-[12px] space-y-1">
                  {result.automation.map((a) => (
                    <li key={a.name} className={a.ok ? "text-emerald-700" : "text-rose-700"}>
                      {a.ok ? "✓" : "✗"} {a.name}: {a.ok ? `automatización de reseñas activa (escenario #${a.scenarioId})` : a.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-2xl">
          <div>
            {step !== 3 && (
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
                Cancelar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 && src && (
              <button onClick={() => loadSources()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-white">
                <RefreshCw className="h-4 w-4" /> Actualizar
              </button>
            )}
            {step === 2 && (
              <button
                onClick={connectSelected}
                disabled={busy || !account || selected.size === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Vincular seleccionadas{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
            )}
            {step === 3 && (
              <>
                <button onClick={() => { setResult(null); setStep(1); loadSources(); }} className="px-4 py-2 rounded-lg border text-sm hover:bg-white">
                  Vincular más
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
                  Ver fichas
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Cuenta de Google", "Elegir fichas", "Confirmación"];
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b bg-slate-50/50">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={
                "h-5 w-5 rounded-full text-[11px] font-semibold flex items-center justify-center " +
                (active ? "bg-brand-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500")
              }
            >
              {done ? "✓" : n}
            </span>
            <span className={"text-[12px] " + (active ? "text-slate-900 font-medium" : "text-slate-400")}>{label}</span>
            {n < 3 && <span className="w-4 h-px bg-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}

function SetupNotice({ setup }: { setup: Status["setup"] }) {
  if (!setup) return null;
  if (!setup.isAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        La conexión con Google aún no está disponible en tu espacio. Avisa a un administrador para que la active.
      </div>
    );
  }
  // Guía para el ADMIN — sin secretos, solo qué configurar.
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
      <div className="font-semibold mb-2 flex items-center gap-1.5">
        <ShieldAlert className="h-4 w-4" /> Falta configuración (solo admin)
      </div>
      {setup.issue === "server" ? (
        <p className="mb-2">
          Falta <code className="px-1 bg-white/60 rounded">NEXTAUTH_SECRET</code> en el servidor. Añádelo en las variables
          de entorno del despliegue y reinicia.
        </p>
      ) : (
        <ol className="list-decimal ml-4 space-y-1 mb-2">
          <li>
            En Google Cloud Console → APIs y servicios → Credenciales, crea un <b>ID de cliente OAuth</b> (tipo «Aplicación web»).
          </li>
          <li>
            Añade esta URL de redirección autorizada:
            <div className="mt-1 flex items-center gap-2">
              <code className="px-2 py-1 bg-white rounded border text-[12px] break-all">{setup.redirectUri}</code>
            </div>
          </li>
          <li>
            Habilita las APIs: <i>My Business Account Management</i>, <i>My Business Business Information</i> y <i>Business Profile Performance</i>.
          </li>
          <li>
            Define <code className="px-1 bg-white/60 rounded">GOOGLE_CLIENT_ID</code> y{" "}
            <code className="px-1 bg-white/60 rounded">GOOGLE_CLIENT_SECRET</code> en el entorno y reinicia.
          </li>
        </ol>
      )}
      <a
        href="https://developers.google.com/my-business/content/prereqs"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-amber-800 underline"
      >
        Documentación de Google <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
      <div className="mb-2">{message}</div>
      <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-rose-700 underline">
        <RefreshCw className="h-3.5 w-3.5" /> Reintentar
      </button>
    </div>
  );
}

function GoogleGlyph({ light }: { light?: boolean }) {
  // Glifo simple (no imagen externa) para no depender de assets.
  return (
    <span
      className={
        "inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold " +
        (light ? "bg-white text-brand-700" : "bg-slate-100 text-slate-700")
      }
    >
      G
    </span>
  );
}
