"use client";

import { useState } from "react";
import clsx from "clsx";
import { Loader2, Check, Power, Trash2, FlaskConical, ChevronDown } from "lucide-react";
import { jsonFetch } from "@/components/inbox/ui";
import type { Overview, SourceView } from "./types";
import { SOURCE_STATUS, fmtRelative } from "./types";

export default function PortalsView({ overview, reload, onRunStarted }: { overview: Overview; reload: () => void; onRunStarted: () => void }) {
  const { sources, isAdmin } = overview;
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  return (
    <div>
      {!isAdmin && <p className="mb-3 text-sm text-slate-500">Solo un administrador del negocio puede añadir o cambiar los accesos a los portales.</p>}
      {notice && (
        <div className={clsx("mb-3 rounded-xl border p-3 text-sm", notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700")}>{notice.text}</div>
      )}
      <div className="space-y-2">
        {sources.map((s) => (
          <PortalRow
            key={s.portal}
            source={s}
            isAdmin={isAdmin}
            expanded={open === s.portal}
            onToggleExpand={() => setOpen(open === s.portal ? null : s.portal)}
            reload={reload}
            setNotice={setNotice}
            onRunStarted={onRunStarted}
          />
        ))}
      </div>
    </div>
  );
}

function PortalRow({ source, isAdmin, expanded, onToggleExpand, reload, setNotice, onRunStarted }: {
  source: SourceView; isAdmin: boolean; expanded: boolean; onToggleExpand: () => void;
  reload: () => void; setNotice: (n: { tone: "ok" | "error"; text: string } | null) => void; onRunStarted: () => void;
}) {
  const [username, setUsername] = useState(source.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const status = SOURCE_STATUS[source.status] ?? SOURCE_STATUS.pending;

  async function saveCreds() {
    setBusy("save");
    const { ok, data } = await jsonFetch<{ error?: string }>("/api/v1/radar/sources", {
      method: "POST",
      body: JSON.stringify({ portal: source.portal, username, password: password || undefined, enabled: true }),
    });
    setBusy("");
    if (ok) { setPassword(""); setNotice({ tone: "ok", text: `Acceso de ${source.name} guardado.` }); reload(); }
    else setNotice({ tone: "error", text: data.error ?? "No se pudo guardar." });
  }

  async function toggleEnabled() {
    setBusy("toggle");
    await jsonFetch(`/api/v1/radar/sources/${source.portal}`, { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) });
    setBusy(""); reload();
  }

  async function removeCreds() {
    if (!confirm(`¿Quitar el acceso a ${source.name}?`)) return;
    setBusy("remove");
    await jsonFetch(`/api/v1/radar/sources/${source.portal}`, { method: "DELETE" });
    setBusy(""); reload();
  }

  async function test() {
    setBusy("test");
    const { ok, data } = await jsonFetch<{ error?: string }>(`/api/v1/radar/sources/${source.portal}/test`, { method: "POST" });
    setBusy("");
    if (ok) { setNotice({ tone: "ok", text: `Probando el acceso a ${source.name}…` }); onRunStarted(); }
    else setNotice({ tone: "error", text: data.error ?? "No se pudo probar." });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={onToggleExpand} className="flex w-full items-center gap-3 p-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900">{source.name}</span>
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", status.tone)}>{status.label}</span>
            {!source.enabled && source.hasCredentials && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Desactivado</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {source.loginHost}
            {source.hasCredentials && source.lastOkAt && ` · ${source.lastCount ?? 0} coches · ${fmtRelative(source.lastOkAt)}`}
            {!source.hasCredentials && " · sin acceso configurado"}
          </p>
          {source.statusDetail && ["login_failed", "attention", "blocked", "error"].includes(source.status) && (
            <p className="mt-0.5 text-xs text-rose-600">{source.statusDetail}</p>
          )}
        </div>
        <ChevronDown size={18} className={clsx("shrink-0 text-slate-400 transition", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-3">
          {source.notes && <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{source.notes}</p>}
          {isAdmin ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuario" autoComplete="off" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={source.hasCredentials ? "Contraseña (déjala vacía para no cambiarla)" : "Contraseña"} type="password" autoComplete="new-password" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void saveCreds()} disabled={busy === "save" || !username} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                  {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar acceso
                </button>
                {source.hasCredentials && (
                  <>
                    <button onClick={() => void test()} disabled={busy === "test"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Probar acceso
                    </button>
                    <button onClick={() => void toggleEnabled()} disabled={busy === "toggle"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Power size={14} /> {source.enabled ? "Desactivar" : "Activar"}
                    </button>
                    <button onClick={() => void removeCreds()} disabled={busy === "remove"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                      <Trash2 size={14} /> Quitar
                    </button>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-400">La contraseña se guarda cifrada y no se vuelve a mostrar. El radar solo lee anuncios: nunca puja ni compra.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{source.hasCredentials ? "Acceso configurado." : "Sin acceso configurado."}</p>
          )}
        </div>
      )}
    </div>
  );
}
