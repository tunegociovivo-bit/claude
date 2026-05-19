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
  currentStage?: string | null;
  lastHeartbeatAt?: string | null;
  stats?: any;
};

export default function AsanaImportPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [token, setToken] = useState("");
  const [savedConnection, setSavedConnection] = useState<{
    hasToken: boolean;
    asanaUserId: string | null;
    createdAt: string | null;
  } | null>(null);
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
  async function loadSavedConnection() {
    const r = await fetch("/api/v1/admin/asana/connection");
    if (r.ok) setSavedConnection(await r.json());
  }
  useEffect(() => {
    loadHistory();
    loadSavedConnection();
  }, []);

  async function checkToken(useSaved = false) {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/asana/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useSaved ? { useSaved: true } : { token })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        // Si el server detectó que el token guardado ya no vale y lo
        // borró, refrescamos el banner ("Token guardado" desaparece)
        // para que el user pegue uno nuevo sin confusión.
        const code = e?.error?.code;
        if (code === "saved_token_invalid" || code === "decrypt_failed") {
          loadSavedConnection();
        }
        throw new Error(e?.error?.message ?? "Token no válido");
      }
      const data = await r.json();
      setUser(data.user);
      setWorkspaces(data.workspaces);
      setWsGid(data.workspaces[0]?.gid ?? "");
      setStep(2);
      // Refrescamos para que aparezca "guardado" tras conectar la 1ª vez
      loadSavedConnection();
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function forgetToken() {
    if (!confirm("¿Borrar el token de Asana guardado?\n\nTendrás que volver a pegarlo la próxima vez.")) return;
    const r = await fetch("/api/v1/admin/asana/connection", { method: "DELETE" });
    if (r.ok) {
      setSavedConnection({ hasToken: false, asanaUserId: null, createdAt: null });
    }
  }

  async function loadProjects() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/asana/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sin token → el server usa el guardado si lo hay.
        body: JSON.stringify({ workspaceGid: wsGid, ...(token ? { token } : {}) })
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
      const body: any = { asanaWorkspaceGid: wsGid };
      if (token) body.token = token; // si no, el server usa el guardado
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

      <ReimportSectionPanel />

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

          {savedConnection?.hasToken && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="flex-1 text-sm text-emerald-900">
                Token guardado{" "}
                {savedConnection.createdAt && (
                  <span className="text-emerald-700">
                    desde {new Date(savedConnection.createdAt).toLocaleDateString("es-ES")}
                  </span>
                )}
                . Puedes reutilizarlo sin volver a pegarlo.
              </div>
              <button
                onClick={() => checkToken(true)}
                disabled={loading}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Usar guardado"}
              </button>
              <button
                onClick={forgetToken}
                disabled={loading}
                className="px-2 py-1.5 rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs disabled:opacity-50"
                title="Olvidar token guardado"
              >
                Olvidar
              </button>
            </div>
          )}

          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={savedConnection?.hasToken ? "Pegar uno nuevo para sustituir el guardado…" : "2/1209…"}
            className="w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={() => checkToken(false)}
            disabled={!token || loading}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {savedConnection?.hasToken ? "Reemplazar y continuar" : "Continuar"}
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
            <>
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="text-slate-600">
                  {selectedProjects.size} de {projects.length} seleccionados
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProjects(new Set(projects.map((p) => p.gid)))}
                    className="px-2 py-1 rounded border bg-white hover:bg-slate-50 text-slate-700"
                  >
                    Seleccionar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProjects(new Set())}
                    className="px-2 py-1 rounded border bg-white hover:bg-slate-50 text-slate-700"
                  >
                    Deseleccionar todos
                  </button>
                </div>
              </div>
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
            </>
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

          {/* Etapa actual + último heartbeat — para que el user vea
              QUÉ está haciendo el job y si sigue vivo. Si hace >5 min
              que no hay heartbeat, advertimos en rojo. */}
          {job && (job.currentStage || job.lastHeartbeatAt) && (
            <div className="mb-4 text-sm">
              {job.currentStage && (
                <div className="text-slate-700">
                  <strong>Etapa:</strong> {job.currentStage}
                </div>
              )}
              {job.lastHeartbeatAt && job.status === "RUNNING" && (() => {
                const ageMs = Date.now() - new Date(job.lastHeartbeatAt).getTime();
                const ageS = Math.round(ageMs / 1000);
                const stale = ageMs > 5 * 60 * 1000;
                return (
                  <div className={stale ? "text-rose-700 font-medium" : "text-slate-500 text-xs"}>
                    Última actualización hace {ageS < 60 ? `${ageS}s` : `${Math.round(ageS / 60)} min`}
                    {stale && " — posible bloqueo, considera relanzar"}
                  </div>
                );
              })()}
            </div>
          )}

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

type LocalProject = {
  id: string;
  name: string;
  asanaId: string | null;
};
type SectionInfo = { gid: string; name: string };
type KanbanCol = { id: string; label: string };

function ReimportSectionPanel() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [kanbanCols, setKanbanCols] = useState<KanbanCol[]>([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [reimportingGid, setReimportingGid] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProjects() {
    const r = await fetch("/api/v1/projects");
    if (r.ok) {
      const d = await r.json();
      const onlyAsana = (d.items ?? []).filter((p: any) => p.asanaId);
      setProjects(onlyAsana);
    }
  }
  useEffect(() => {
    if (open) loadProjects();
  }, [open]);

  async function loadSections(projectId: string) {
    setLoadingSections(true);
    setError(null);
    setSections([]);
    setKanbanCols([]);
    try {
      const r = await fetch(
        `/api/v1/admin/asana/reimport-section?projectId=${encodeURIComponent(projectId)}`
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      setSections(d.sections ?? []);
      setKanbanCols((d.kanbanColumns ?? []).map((c: any) => ({ id: c.id, label: c.label })));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoadingSections(false);
    }
  }

  function onProjectChange(id: string) {
    setSelectedProjectId(id);
    setLastResult(null);
    if (id) loadSections(id);
    else {
      setSections([]);
      setKanbanCols([]);
    }
  }

  async function reimport(sectionGid: string, sectionName: string) {
    if (!selectedProjectId) return;
    if (!confirm(
      `Re-importar la columna "${sectionName}"?\n\nVa a sincronizar todas sus tareas desde Asana, actualizando títulos, descripciones, comentarios y adjuntos. Idempotente: lo que ya existe se refresca + re-enlaza.`
    )) return;
    setReimportingGid(sectionGid);
    setError(null);
    setLastResult(null);
    try {
      const r = await fetch("/api/v1/admin/asana/reimport-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          sectionGid
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
      setLastResult(d);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setReimportingGid(null);
    }
  }

  if (!open) {
    return (
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-sky-900">🔄 Re-importar una columna concreta</h3>
          <p className="text-xs text-sky-700 mt-0.5">
            Útil si una columna de un proyecto importado arrastra fallos
            (tasks corruptas, comentarios huérfanos). Re-sincroniza solo esa
            columna sin tocar el resto del proyecto.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg"
        >
          Abrir
        </button>
      </div>
    );
  }

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-sky-900">
          🔄 Re-importar una columna concreta
        </h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-sky-700 hover:text-sky-900"
        >
          Cerrar
        </button>
      </div>

      <label className="text-xs text-sky-800 block mb-1">Proyecto importado de Asana</label>
      <select
        value={selectedProjectId}
        onChange={(e) => onProjectChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 p-2 text-sm mb-3"
      >
        <option value="">— elige proyecto —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {loadingSections && (
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando columnas desde Asana…
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-2">
          {error}
        </div>
      )}

      {sections.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-sky-800 mb-1">
            Selecciona la columna a re-importar:
          </div>
          {sections.map((s) => {
            const matchedCol = kanbanCols.find(
              (c) => c.label?.toLowerCase().trim() === s.name.toLowerCase().trim()
            );
            return (
              <div
                key={s.gid}
                className="flex items-center justify-between bg-white border border-sky-200 rounded-lg p-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{s.name}</div>
                  <div className="text-[10px] text-slate-500">
                    Asana gid: <code>{s.gid}</code>
                    {matchedCol && (
                      <>
                        {" "}
                        · mapea a{" "}
                        <code className="bg-slate-100 px-1 rounded">{matchedCol.id}</code>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => reimport(s.gid, s.name)}
                  disabled={!!reimportingGid}
                  className="text-xs bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white px-3 py-1 rounded-lg whitespace-nowrap"
                >
                  {reimportingGid === s.gid ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Importando…
                    </span>
                  ) : (
                    "Re-importar"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {lastResult && (
        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs">
          <div className="font-semibold text-emerald-800 mb-1">
            ✅ {lastResult.sectionName} re-importado
          </div>
          <div className="text-emerald-700 grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div>Tareas procesadas: {lastResult.tasksProcessed}</div>
            <div>Creadas: {lastResult.tasksCreated}</div>
            <div>Actualizadas: {lastResult.tasksUpdated}</div>
            <div>Comentarios nuevos: {lastResult.commentsImported}</div>
            <div>Comentarios actualizados: {lastResult.commentsUpdated}</div>
            <div>
              Adjuntos: {lastResult.attachmentsImported} nuevos, {lastResult.attachmentsSkipped}{" "}
              ya estaban
            </div>
          </div>
          {Array.isArray(lastResult.warnings) && lastResult.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-amber-700">
                {lastResult.warnings.length} avisos
              </summary>
              <ul className="mt-1 text-amber-700 space-y-0.5 max-h-32 overflow-y-auto">
                {lastResult.warnings.map((w: string, i: number) => (
                  <li key={i} className="text-[10px]">
                    · {w}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
