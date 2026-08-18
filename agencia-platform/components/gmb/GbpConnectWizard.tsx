"use client";

/**
 * Asistente de vinculación de Google Business Profile — estilo Make.
 * 3 pasos: (1) Conectar con Google → (2) Elegir cuenta + fichas → (3) Confirmación.
 * Sin IDs/claves a mano: el usuario solo pulsa «Conectar con Google» y elige de listas REALES.
 * Nunca simula estar conectado: todo sale de /api/v1/gmb/google/*.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X, Search, Check, ChevronLeft, RefreshCw, MapPin, ShieldAlert, ExternalLink } from "lucide-react";

type Status = {
  ok: boolean;
  configured: boolean;
  setup: { issue: "server" | "google_credentials"; isAdmin: boolean; redirectUri?: string } | null;
  connection: { connected: boolean; email?: string | null; hasBusinessScope?: boolean; revoked?: boolean; lastError?: string | null };
  linkedClients?: number;
};
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

const CONNECT_URL = "/api/integrations/gmb-google/connect";

export default function GbpConnectWizard({
  open,
  onClose,
  onLinked,
  initialStep,
}: {
  open: boolean;
  onClose: () => void;
  onLinked?: () => void;
  initialStep?: 1 | 2;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [locsErr, setLocsErr] = useState<string | null>(null);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; total: number } | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const r = await fetch("/api/v1/gmb/google/status", { cache: "no-store" });
      const d: Status = await r.json();
      setStatus(d);
      return d;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsErr(null);
    setAccounts(null);
    try {
      const r = await fetch("/api/v1/gmb/google/accounts", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) {
        setAccountsErr(d.message || "No se pudieron cargar las cuentas de Google.");
        setAccounts([]);
        return;
      }
      setAccounts(d.accounts ?? []);
      if ((d.accounts ?? []).length === 1) setAccount(d.accounts[0].accountId);
    } catch (e: any) {
      setAccountsErr("No se pudieron cargar las cuentas de Google.");
      setAccounts([]);
    }
  }, []);

  // Al abrir: comprueba estado y decide en qué paso arrancar.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    (async () => {
      const d = await refreshStatus();
      if (d?.connection?.connected) {
        setStep(2);
        loadAccounts();
      } else {
        setStep(initialStep === 2 ? 1 : 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Al seleccionar cuenta, carga ubicaciones reales.
  useEffect(() => {
    if (step !== 2 || !account) return;
    setLoadingLocs(true);
    setLocsErr(null);
    setLocations(null);
    setSelected(new Set());
    (async () => {
      try {
        const r = await fetch(`/api/v1/gmb/google/locations?accountId=${encodeURIComponent(account)}`, { cache: "no-store" });
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
  }, [step, account]);

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
    if (!account || selected.size === 0) return;
    setBusy(true);
    try {
      const chosen = (locations ?? []).filter((l) => selected.has(l.locationId));
      const r = await fetch("/api/v1/gmb/google/connect-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account, locations: chosen }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setLocsErr(d.message || "No se pudieron vincular las fichas.");
        return;
      }
      setResult({ created: d.created ?? 0, updated: d.updated ?? 0, total: d.total ?? chosen.length });
      setStep(3);
      onLinked?.();
    } catch {
      setLocsErr("No se pudieron vincular las fichas.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const noScope = status?.connection?.connected && status?.connection?.hasBusinessScope === false;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
        {/* Cabecera + pasos */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <GoogleGlyph />
            <div className="font-semibold text-sm">Conectar con Google Business Profile</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Steps step={step} />

        <div className="px-5 py-5">
          {/* ───────── Paso 1: Conectar con Google ───────── */}
          {step === 1 && (
            <div>
              {loadingStatus ? (
                <Loading label="Comprobando conexión…" />
              ) : status && !status.configured ? (
                <SetupNotice setup={status.setup} />
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-4">
                    Autoriza el acceso a tus fichas de Google. Solo pedimos el permiso para gestionar tu Perfil de Empresa
                    (<span className="font-medium">business.manage</span>). No tienes que introducir IDs ni claves.
                  </p>
                  <a
                    href={CONNECT_URL}
                    className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
                  >
                    <GoogleGlyph light /> Conectar con Google
                  </a>
                  <p className="text-[11px] text-slate-400 mt-3">
                    Se abrirá la pantalla de consentimiento de Google. Tus credenciales nunca pasan por aquí.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ───────── Paso 2: Elegir cuenta + fichas ───────── */}
          {step === 2 && (
            <div>
              {noScope && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
                  <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    Conectaste con Google pero sin el permiso para gestionar fichas.{" "}
                    <a href={CONNECT_URL} className="underline font-medium">
                      Reconectar y aceptar el permiso
                    </a>
                    .
                  </div>
                </div>
              )}

              {status?.connection?.email && (
                <div className="mb-3 text-[12px] text-slate-500">
                  Conectado como <span className="font-medium text-slate-700">{status.connection.email}</span>
                </div>
              )}

              {/* Cuentas */}
              {!accounts ? (
                <Loading label="Cargando cuentas de Google…" />
              ) : accountsErr ? (
                <ErrorBox message={accountsErr} onRetry={loadAccounts} />
              ) : accounts.length === 0 ? (
                <div className="text-sm text-slate-500">
                  No hay cuentas de Business Profile accesibles con esta cuenta de Google.
                </div>
              ) : (
                <>
                  {accounts.length > 1 && (
                    <div className="mb-4">
                      <label className="block text-[12px] font-medium text-slate-600 mb-1">Cuenta</label>
                      <select
                        value={account ?? ""}
                        onChange={(e) => setAccount(e.target.value || null)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">Elige una cuenta…</option>
                        {accounts.map((a) => (
                          <option key={a.accountId} value={a.accountId}>
                            {a.name || a.accountId} {a.state ? `· ${a.state}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {account && (
                    <div>
                      {/* Buscador + seleccionar todo */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar ficha por nombre o dirección…"
                            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
                          />
                        </div>
                        {(filtered.length > 0) && (
                          <button onClick={toggleAll} className="text-[12px] text-brand-600 hover:underline whitespace-nowrap">
                            {allSelected ? "Quitar todo" : "Todo"}
                          </button>
                        )}
                      </div>

                      {loadingLocs ? (
                        <Loading label="Cargando ubicaciones…" />
                      ) : locsErr ? (
                        <ErrorBox message={locsErr} onRetry={() => setAccount((a) => a)} />
                      ) : (locations ?? []).length === 0 ? (
                        <div className="text-sm text-slate-500 py-4">Esta cuenta no tiene ubicaciones.</div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                          {filtered.map((l) => {
                            const on = selected.has(l.locationId);
                            return (
                              <button
                                key={l.locationId}
                                onClick={() => toggle(l.locationId)}
                                className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                              >
                                <span
                                  className={
                                    "mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 " +
                                    (on ? "bg-brand-600 border-brand-600" : "border-slate-300")
                                  }
                                >
                                  {on && <Check className="h-3 w-3 text-white" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium truncate">{l.title || "Sin nombre"}</span>
                                  {l.address && (
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
                                      <MapPin className="h-3 w-3 shrink-0" /> {l.address}
                                    </span>
                                  )}
                                  {l.primaryCategory && (
                                    <span className="text-[11px] text-slate-400">{l.primaryCategory}</span>
                                  )}
                                </span>
                                {l.linked && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                    Vinculada
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {filtered.length === 0 && (
                            <div className="px-3 py-4 text-sm text-slate-400">Sin resultados para «{search}».</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ───────── Paso 3: Confirmación ───────── */}
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
              <p className="text-[12px] text-slate-400 mt-2">
                La sincronización inicial (reseñas, insights) se ejecuta en segundo plano.
              </p>
            </div>
          )}
        </div>

        {/* Pie: navegación */}
        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-2xl">
          <div>
            {step === 2 && (
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
                Cancelar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={connectSelected}
                disabled={busy || !account || selected.size === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Conectar seleccionadas{selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
            )}
            {step === 3 && (
              <>
                <button
                  onClick={() => {
                    setResult(null);
                    setStep(2);
                    loadAccounts();
                  }}
                  className="px-4 py-2 rounded-lg border text-sm hover:bg-white"
                >
                  Conectar más
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
                  Ver fichas
                </button>
              </>
            )}
            {step === 1 && !loadingStatus && status && !status.configured && (
              <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm hover:bg-white">
                Entendido
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ["Conectar Google", "Elegir fichas", "Confirmación"];
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
