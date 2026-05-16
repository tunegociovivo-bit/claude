"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Key, FolderTree, PlayCircle, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";

type Workspace = { gid: string; name: string };
type Project = { gid: string; name: string };
type Job = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  finishedAt?: string | null;
  errorMsg?: string | null;
  stats?: any;
};

export default function AsanaImportPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [token, setToken] = useState("");
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsGid, setWsGid] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [importAll, setImportAll] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  async function loadHistory() {
    const r = await fetch("/api/v1/admin/asana/imports");
    if (r.ok) {
      const data = await r.json();
      setHistory(data.items);
    }
  }
  useEffect(() => {
    loadHistory();
  }, []);

  async function checkToken() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/asana/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "Token no válido");
      }
      const data = await r.json();
      setUser(data.user);
      setWorkspaces(data.workspaces);
      setWsGid(data.workspaces[0]?.gid ?? "");
      setStep(2);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/asana/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, workspaceGid: wsGid })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "No se pudo listar proyectos");
      }
      const data = await r.json();
      setProjects(data.items);
      setSelectedProjects(new Set(data.items.map((p: Project) => p.gid)));
      setStep(3);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function startImport() {
    setError(null);
    setLoading(true);
    try {
      const body: any = { token, asanaWorkspaceGid: wsGid };
      if (!importAll) body.projectGids = Array.from(selectedProjects);
      const r = await fetch("/api/v1/admin/asana/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "No se pudo lanzar");
      }
      const data = await r.json();
      setStep(4);
      pollJob(data.jobId);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function pollJob(jobId: string) {
    async function tick() {
      const r = await fetch(`/api/v1/admin/asana/imports/${jobId}`);
      if (r.ok) {
        const j = await r.json();
        setJob(j);
        if (j.status === "COMPLETED" || j.status === "FAILED") {
          clearInterval(pollRef.current);
          loadHistory();
        }
      }
    }
    tick();
    pollRef.current = setInterval(tick, 2000);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Migración desde Asana"
        description="Importa workspaces, proyectos, tareas, subtareas, tags, comentarios y asignados."
      />

      <ol className="flex items-center gap-3 text-xs text-slate-500 mb-6">
        {[
          { n: 1, label: "Token" },
          { n: 2, label: "Workspace" },
          { n: 3, label: "Proyectos" },
          { n: 4, label: "Importar" }
        ].map((s, i, arr) => (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={`h-5 w-5 rounded-full grid place-items-center text-[11px] font-medium ${
                step >= s.n ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"
              }`}
            >
              {s.n}
            </span>
            <span className={step === s.n ? "text-slate-900 font-medium" : ""}>{s.label}</span>
            {i < arr.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Key className="h-4 w-4 text-slate-400" />
            Personal Access Token de Asana
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Crea uno en{" "}
            <a
              href="https://app.asana.com/0/my-apps"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 underline inline-flex items-center gap-1"
            >
              app.asana.com/0/my-apps <ExternalLink className="h-3 w-3" />
            </a>{" "}
            (sección "Developer apps" → "Create new token"). Solo se usa para esta importación y se guarda
            cifrado en tu cuenta de Agencia Hub.
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="2/1209…"
            className="w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={checkToken}
            disabled={!token || loading}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Continuar
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-xl border p-6">
          <div className="text-xs text-slate-500 mb-2">Conectado como</div>
          <div className="text-sm font-medium mb-4">
            {user?.name} <span className="text-slate-400">· {user?.email}</span>
          </div>

          <h2 className="font-semibold mb-3">Workspace de Asana a importar</h2>
          <ul className="space-y-2 mb-5">
            {workspaces.map((w) => (
              <li key={w.gid}>
                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="ws"
                    value={w.gid}
                    checked={wsGid === w.gid}
                    onChange={() => setWsGid(w.gid)}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{w.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{w.gid}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-3 py-2 rounded-lg border text-sm hover:bg-slate-50">
              Atrás
            </button>
            <button
              onClick={loadProjects}
              disabled={!wsGid || loading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Ver proyectos
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-slate-400" />
            Proyectos a importar
          </h2>

          <label className="flex items-center gap-2 p-3 rounded-lg border bg-slate-50 mb-3 text-sm">
            <input
              type="checkbox"
              checked={importAll}
              onChange={(e) => setImportAll(e.target.checked)}
            />
            Importar todos los proyectos de este workspace ({projects.length})
          </label>

          {!importAll && (
            <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y mb-3">
              {projects.map((p) => (
                <li key={p.gid} className="px-3 py-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedProjects.has(p.gid)}
                    onChange={(e) => {
                      const next = new Set(selectedProjects);
                      if (e.target.checked) next.add(p.gid);
                      else next.delete(p.gid);
                      setSelectedProjects(next);
                    }}
                  />
                  <span className="text-sm">{p.name}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500 mb-4">
            La importación es <strong>idempotente</strong>: si vuelves a lanzarla, se actualizarán los registros existentes (identificados por su Asana ID) en lugar de duplicarlos.
          </p>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="px-3 py-2 rounded-lg border text-sm hover:bg-slate-50">
              Atrás
            </button>
            <button
              onClick={startImport}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <PlayCircle className="h-4 w-4" />
              Lanzar importación
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            {job?.status === "COMPLETED" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : job?.status === "FAILED" ? (
              <XCircle className="h-5 w-5 text-rose-600" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            )}
            {job?.status === "COMPLETED"
              ? "Importación completada"
              : job?.status === "FAILED"
              ? "Importación falló"
              : "Importando…"}
          </h2>

          {job?.stats && (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                {([
                  ["users", "Usuarios"],
                  ["projects", "Proyectos"],
                  ["tasks", "Tareas"],
                  ["subtasks", "Subtareas"],
                  ["tags", "Tags"],
                  ["comments", "Comentarios"]
                ] as const).map(([k, l]) => (
                  <div key={k} className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs text-slate-500">{l}</div>
                    <div className="text-lg font-semibold">{job.stats?.[k] ?? 0}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-emerald-50 rounded-lg p-3">
                  <div className="text-xs text-emerald-700">Adjuntos descargados</div>
                  <div className="text-lg font-semibold text-emerald-900">
                    {job.stats?.attachmentsImported ?? 0}
                  </div>
                </div>
                <div className="bg-sky-50 rounded-lg p-3">
                  <div className="text-xs text-sky-700">Adjuntos externos (link)</div>
                  <div className="text-lg font-semibold text-sky-900">
                    {job.stats?.attachmentsExternal ?? 0}
                  </div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <div className="text-xs text-amber-700">Adjuntos fallidos</div>
                  <div className="text-lg font-semibold text-amber-900">
                    {job.stats?.attachmentsFailed ?? 0}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-600">Comentarios ya migrados</div>
                  <div className="text-lg font-semibold text-slate-700">
                    {job.stats?.commentsSkipped ?? 0}
                  </div>
                </div>
              </div>
              {Array.isArray(job.stats?.warnings) && job.stats.warnings.length > 0 && (
                <details className="mb-4 rounded-lg border bg-amber-50/40 border-amber-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-amber-800 font-medium">
                    Avisos ({job.stats.warnings.length})
                  </summary>
                  <ul className="px-3 pb-3 text-[11px] text-slate-700 space-y-0.5">
                    {job.stats.warnings.slice(0, 50).map((w: string, i: number) => (
                      <li key={i} className="font-mono">{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {job?.errorMsg && (
            <p className="text-sm text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200 mb-3">
              {job.errorMsg}
            </p>
          )}

          {(job?.status === "COMPLETED" || job?.status === "FAILED") && (
            <button
              onClick={() => {
                setStep(1);
                setJob(null);
                setToken("");
                setUser(null);
                setProjects([]);
              }}
              className="mt-2 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50"
            >
              Otra importación
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white rounded-xl border mt-6">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Historial</h2>
          </div>
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.id} className="p-4 flex items-center gap-4">
                <span
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    h.status === "COMPLETED"
                      ? "bg-emerald-50 text-emerald-700"
                      : h.status === "FAILED"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {h.status}
                </span>
                <div className="flex-1 text-xs text-slate-500">
                  {new Date(h.startedAt).toLocaleString("es-ES")} ·{" "}
                  {h.stats?.tasks ?? 0} tareas, {h.stats?.projects ?? 0} proyectos
                </div>
                {h.errorMsg && (
                  <span className="text-xs text-rose-600 max-w-xs truncate">{h.errorMsg}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
