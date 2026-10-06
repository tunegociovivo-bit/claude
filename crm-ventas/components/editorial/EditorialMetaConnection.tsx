"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

type Connection = { id: string; metaUserId: string | null; displayName: string | null; expiresAt: string | null; expired: boolean; updatedAt: string };
type Account = { id: string; name: string; metaConnectionId: string; connectionName?: string | null; business?: { name: string }; instagram_business_account?: { id: string; username?: string } };
type Profile = { id: string; label: string; active: boolean; facebookPageId: string | null; instagramUserId: string | null; facebookPageName: string | null; instagramName: string | null; metaConnection?: { expiresAt: string | null } | null };

async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "No se pudo completar la operación.");
  return data;
}

/**
 * Conexión del negocio con Facebook/Instagram (CRM). Sustituye a la pantalla
 * /meta del Hub: el administrador pega el token de Meta y después elige qué
 * página (con su Instagram vinculado) usará el Editorial para publicar.
 */
export default function EditorialMetaConnection({ onChanged }: { onChanged?: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [token, setToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function load() {
    const [status, linked] = await Promise.all([
      request("/api/v1/editorial/meta-connection"),
      request("/api/v1/editorial/meta-profiles")
    ]);
    setConnections(status.connections ?? []);
    setCanManage(Boolean(status.canManage));
    setProfiles(linked.items ?? []);
  }

  useEffect(() => {
    load()
      .catch((error) => setMessage({ kind: "error", text: error.message }))
      .finally(() => setLoading(false));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Error de conexión" });
    } finally {
      setBusy(false);
    }
  }

  const connected = connections.some((connection) => !connection.expired);
  const activeProfiles = profiles.filter((profile) => profile.active);
  const button = "inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comprobando la conexión con Meta…
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {/* 1. Token */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">1. Token de Meta</span>
          <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + (connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
            {connected ? "Conectado" : "Sin conectar"}
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          El token sale de Meta Business Suite → Configuración del negocio → Usuarios del sistema → Generar token (o un token de página) con los permisos pages_manage_posts, pages_read_engagement, instagram_basic e instagram_content_publish.
        </p>
        {connections.map((connection) => (
          <div key={connection.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-xs">
            <span className="min-w-0 truncate">
              {connection.displayName || connection.metaUserId || "Cuenta de Meta"}
              {connection.expired
                ? <span className="ml-1 text-rose-600">· caducado</span>
                : connection.expiresAt
                  ? <span className="ml-1 text-slate-500">· caduca el {new Date(connection.expiresAt).toLocaleDateString("es-ES")}</span>
                  : <span className="ml-1 text-slate-500">· sin caducidad</span>}
            </span>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50"
                onClick={() => {
                  if (!confirm("¿Desconectar esta cuenta de Meta? Las publicaciones programadas con ella no se enviarán.")) return;
                  void run(async () => {
                    await request(`/api/v1/editorial/meta-connection?connectionId=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
                    await load();
                    onChanged?.();
                    setMessage({ kind: "ok", text: "Conexión eliminada." });
                  });
                }}
              >
                <Trash2 className="h-3 w-3" /> Desconectar
              </button>
            )}
          </div>
        ))}
        {canManage ? (
          <div className="space-y-2">
            <textarea
              aria-label="Token de acceso de Meta"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              rows={2}
              placeholder="Pega aquí el token de acceso (EAAG…)"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-slate-600">
                Caduca (opcional){" "}
                <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="ml-1 rounded border px-2 py-1 text-xs" />
              </label>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                disabled={busy || token.trim().length < 20}
                onClick={() =>
                  void run(async () => {
                    const data = await request("/api/v1/editorial/meta-connection", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ accessToken: token.trim(), expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:00`).toISOString() : null })
                    });
                    setToken("");
                    setExpiresAt("");
                    await load();
                    onChanged?.();
                    setMessage({ kind: "ok", text: `Token guardado${data.metaUserName ? ` (${data.metaUserName})` : ""}. Ahora elige tu página.` });
                  })
                }
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar token
              </button>
            </div>
          </div>
        ) : (
          !connected && <p className="text-[11px] text-slate-500">Pide a un administrador de tu negocio que conecte la cuenta de Meta.</p>
        )}
      </div>

      {/* 2. Página / Instagram */}
      <div className="space-y-2 border-t pt-3">
        <span className="text-xs font-semibold text-slate-700">2. Página de Facebook e Instagram</span>
        {activeProfiles.map((profile) => {
          const expired = !!profile.metaConnection?.expiresAt && new Date(profile.metaConnection.expiresAt) <= new Date();
          return (
            <div key={profile.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-medium">{profile.facebookPageName || profile.label}</span>
                {profile.instagramName && <span className="text-slate-500"> · Instagram @{profile.instagramName}</span>}
                {!profile.instagramUserId && <span className="text-slate-500"> · sin Instagram vinculado</span>}
                {(expired || !profile.metaConnection) && <span className="text-rose-600"> · {expired ? "token caducado" : "sin token"}</span>}
              </span>
              {canManage && <button
                type="button"
                disabled={busy}
                className="text-rose-600 hover:underline disabled:opacity-50"
                onClick={() => {
                  if (!confirm("¿Quitar esta página? Se cancelarán sus envíos pendientes.")) return;
                  void run(async () => {
                    await request(`/api/v1/editorial/meta-profiles?id=${encodeURIComponent(profile.id)}`, { method: "DELETE" });
                    await load();
                    onChanged?.();
                  });
                }}
              >
                Quitar
              </button>}
            </div>
          );
        })}
        {!activeProfiles.length && <p className="text-[11px] text-slate-500">Todavía no has elegido ninguna página.{!canManage && " Pide a un administrador de tu cuenta que la elija."}</p>}
        {canManage && <button
          type="button"
          className={button}
          disabled={busy || !connected}
          onClick={() =>
            void run(async () => {
              const data = await request("/api/v1/editorial/meta-profiles?discover=1");
              setAccounts(data.accounts || []);
              if (data.errors?.length) setMessage({ kind: "error", text: data.errors.join(" · ") });
            })
          }
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Elegir página de Facebook / Instagram
        </button>}
        {canManage && accounts && (
          <div className="space-y-1.5 rounded-lg border bg-slate-50 p-2">
            {accounts.map((account) => {
              const linked = activeProfiles.some((profile) => profile.facebookPageId === account.id);
              return (
                <div key={`${account.metaConnectionId}:${account.id}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    {account.name}
                    {account.business?.name && ` · ${account.business.name}`}
                    {account.instagram_business_account?.username && ` · @${account.instagram_business_account.username}`}
                  </span>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || linked}
                    onClick={() =>
                      void run(async () => {
                        await request("/api/v1/editorial/meta-profiles", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ metaConnectionId: account.metaConnectionId, label: account.name, facebookPageId: account.id })
                        });
                        await load();
                        onChanged?.();
                        setMessage({ kind: "ok", text: "Página vinculada a tu marca." });
                      })
                    }
                  >
                    {linked ? "Vinculada" : "Usar esta"}
                  </button>
                </div>
              );
            })}
            {!accounts.length && <p className="text-xs text-slate-500">El token no tiene acceso a ninguna página. Revisa que el usuario del sistema tenga asignada tu página en el Business Manager.</p>}
          </div>
        )}
      </div>

      {message && (
        <p role="status" className={"text-xs " + (message.kind === "error" ? "text-rose-600" : "text-emerald-700")}>
          {message.text}
        </p>
      )}
    </div>
  );
}
