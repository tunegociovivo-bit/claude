"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Entry = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: any;
};

/**
 * Tabla del audit log. Los filtros se reflejan en la URL para que la
 * página server-side re-consulte. Click en fila → despliega meta
 * (before/after, ip, userAgent) en JSON.
 */
export default function AuditLogTable({
  entries,
  filterAction,
  filterEntity,
  filterActor,
  actors
}: {
  entries: Entry[];
  filterAction: string;
  filterEntity: string;
  filterActor: string;
  actors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/admin/auditoria?${next.toString()}`);
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={filterActor}
          onChange={(e) => setParam("actor", e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none"
        >
          <option value="">Cualquier autor</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          value={filterEntity}
          onChange={(e) => setParam("entity", e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none"
        >
          <option value="">Cualquier entidad</option>
          <option value="CLIENT">Cliente</option>
          <option value="TASK">Tarea</option>
          <option value="USER">Usuario</option>
          <option value="APIKEY">API key</option>
          <option value="DOCUMENT">Documento</option>
        </select>
        <input
          value={filterAction}
          onChange={(e) => setParam("action", e.target.value)}
          placeholder="action (ej. client.delete)"
          className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none flex-1 min-w-[180px]"
        />
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-6"></th>
              <th className="text-left px-3 py-2">Cuándo</th>
              <th className="text-left px-3 py-2">Quién</th>
              <th className="text-left px-3 py-2">Acción</th>
              <th className="text-left px-3 py-2">Objeto</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-xs italic">
                  Sin entradas que coincidan.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <>
                <tr
                  key={e.id}
                  onClick={() => toggle(e.id)}
                  className="border-t hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-2 py-1.5 text-slate-400">
                    {expanded.has(e.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString("es-ES")}
                  </td>
                  <td className="px-3 py-1.5">
                    {e.actorName ?? <span className="text-slate-400 italic">sistema</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{e.action}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {e.targetType ? (
                      <span>
                        <span className="text-slate-500">{e.targetType}</span>{" "}
                        <span className="text-slate-400">{e.targetId}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {expanded.has(e.id) && (
                  <tr key={`${e.id}-meta`} className="bg-slate-50">
                    <td colSpan={5} className="px-3 py-2">
                      <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all">
                        {JSON.stringify(e.meta ?? {}, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
