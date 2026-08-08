"use client";

import { useState } from "react";
import { Phone, PhoneOff, ChevronDown, ChevronUp, Play, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useAgentName } from "@/components/AgentNameContext";

type Call = {
  id: string;
  fromNumber: string | null;
  status: string;
  endedReason: string | null;
  durationSec: number | null;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  contactName: string | null;
  createdAt: string;
};

function fmtDuration(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function LlamadasClient({ calls }: { calls: Call[] }) {
  const agentName = useAgentName();
  const [items, setItems] = useState(calls);
  const [open, setOpen] = useState<string | null>(null);

  async function removeCall(id: string) {
    if (!confirm("¿Eliminar esta llamada?")) return;
    const response = await fetch(`/api/v1/calls/${id}`, { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((call) => call.id !== id));
    else {
      const body = await response.json().catch(() => null);
      alert(body?.error ?? "No se pudo eliminar la llamada.");
    }
  }

  async function removeAllCalls() {
    if (!confirm("¿Eliminar todas las llamadas? Esta acción no se puede deshacer.")) return;
    const response = await fetch("/api/v1/calls", { method: "DELETE" });
    if (response.ok) {
      setItems((current) => current.filter((call) => call.status === "en-curso"));
      setOpen(null);
    } else alert("No se pudieron eliminar las llamadas.");
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
        <h1 className="text-xl font-semibold">Llamadas recibidas por {agentName}</h1>
        <p className="text-sm text-slate-500">
          Transcripción y resumen de cada llamada atendida por la IA
        </p>
        </div>
        {items.length > 0 && (
          <button className="btn-ghost inline-flex items-center gap-2 text-red-600" onClick={removeAllCalls}>
            <Trash2 size={15} /> Eliminar todas
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          Todavía no hay llamadas. Cuando alguien llame al número del negocio,
          {agentName} contestará y la llamada aparecerá aquí.
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {items.map((c) => {
            const failed = c.status === "fallida";
            const expanded = open === c.id;
            return (
              <div key={c.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(expanded ? null : c.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setOpen(expanded ? null : c.id);
                  }}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span
                    className={clsx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      failed ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600"
                    )}
                  >
                    {failed ? <PhoneOff size={16} /> : <Phone size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {c.contactName ?? c.fromNumber ?? "Desconocido"}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {c.summary ?? c.endedReason ?? c.status}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <div>
                      {new Date(c.createdAt).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div>{fmtDuration(c.durationSec)}</div>
                  </div>
                  <button
                    type="button"
                    title="Eliminar llamada"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCall(c.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
                {expanded && (
                  <div className="space-y-3 bg-slate-50/60 px-4 py-4 text-sm">
                    {c.summary && (
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-400">
                          Resumen
                        </div>
                        <p>{c.summary}</p>
                      </div>
                    )}
                    {(c.recordingUrl || c.status === "finalizada") && (
                      <a
                        href={`/api/v1/calls/${c.id}/recording`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-brand-600 hover:underline"
                      >
                        <Play size={14} /> Escuchar grabación
                      </a>
                    )}
                    {c.transcript ? (
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-400">
                          Transcripción
                        </div>
                        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-700">
                          {c.transcript}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Sin transcripción</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
