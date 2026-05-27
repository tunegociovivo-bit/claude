"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  CheckSquare,
  Users,
  Briefcase,
  FileText,
  Plus,
  Calendar,
  Database,
  Shield,
  Home,
  ListChecks,
  ArrowRight
} from "lucide-react";

type Result =
  | { kind: "task"; id: string; title: string; clientName?: string }
  | { kind: "client"; id: string; name: string }
  | { kind: "project"; id: string; name: string; clientName?: string }
  | { kind: "document"; id: string; title: string }
  | { kind: "action"; id: string; title: string; href: string; icon?: any };

// Anotamos con la variante concreta (action) para que TS sepa que
// todos los STATIC_ACTIONS tienen `title` y `href`. Si la firma
// fuera el union Result[], `a.title` rompería en el filter porque
// las variantes client/project tienen `name`, no `title`.
type ActionResult = Extract<Result, { kind: "action" }>;

const STATIC_ACTIONS: ActionResult[] = [
  { kind: "action", id: "go-home", title: "Ir al inicio", href: "/", icon: Home },
  { kind: "action", id: "go-tasks", title: "Ir a tareas", href: "/tareas", icon: CheckSquare },
  { kind: "action", id: "go-clients", title: "Ir a clientes", href: "/clientes", icon: Users },
  { kind: "action", id: "go-equipo", title: "Ir a equipo", href: "/equipo", icon: Briefcase },
  { kind: "action", id: "go-documentos", title: "Ir a documentos", href: "/documentos", icon: FileText },
  { kind: "action", id: "go-calendario", title: "Ir a calendario", href: "/calendario", icon: Calendar },
  { kind: "action", id: "go-databases", title: "Ir a databases", href: "/databases", icon: Database },
  { kind: "action", id: "go-mi-dia", title: "Mi día", href: "/mi-dia", icon: ListChecks },
  { kind: "action", id: "go-audit", title: "Auditoría (admin)", href: "/admin/auditoria", icon: Shield },
  { kind: "action", id: "new-task", title: "Crear tarea nueva", href: "/tareas?new=1", icon: Plus },
  { kind: "action", id: "new-client", title: "Crear cliente nuevo", href: "/clientes?new=1", icon: Plus }
];

/**
 * Buscador global Cmd+K. Filtra acciones estáticas inmediatamente y
 * dispara una búsqueda remota debounce 200ms contra
 * /api/v1/search?q=... que devuelve tareas, clientes, proyectos y
 * documentos. Si ese endpoint todavía no existe, cae con gracia y
 * solo muestra acciones.
 */
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Result[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo global Cmd/Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
      setRemote([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Búsqueda remota debounced. Lanzamos en paralelo el ILIKE clásico
  // (instantáneo, match exacto por título/nombre) y la semántica
  // (más lenta porque genera embedding, pero entiende intención).
  // Mezclamos: primero los semánticos con score alto, luego los
  // ILIKE que no estén ya cubiertos.
  useEffect(() => {
    if (!open || !q.trim()) {
      setRemote([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const lexicalPromise = fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal
        }).then((r) => (r.ok ? r.json() : { items: [] }));
        // Solo lanzamos semántica si la query tiene 3+ chars (mínimo
        // significativo y el endpoint la rechaza).
        const semanticPromise =
          q.trim().length >= 3
            ? fetch(`/api/v1/search/semantic?q=${encodeURIComponent(q)}&topK=10`, {
                signal: ctrl.signal
              }).then((r) => (r.ok ? r.json() : { items: [] }))
            : Promise.resolve({ items: [] });
        const [lex, sem] = await Promise.all([lexicalPromise, semanticPromise]);

        // Deduplicar por (kind, id). Semántica primero (ordena por
        // score descendente y suele ser más relevante para queries
        // largas).
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const it of (sem.items ?? []).concat(lex.items ?? [])) {
          const key = `${it.kind}:${it.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(it);
        }
        setRemote(merged);
      } catch {
        /* abort u offline */
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, open]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const actions = term
      ? STATIC_ACTIONS.filter((a) => a.title.toLowerCase().includes(term))
      : STATIC_ACTIONS.slice(0, 6);
    return [...remote, ...actions];
  }, [q, remote]);

  useEffect(() => setIndex(0), [results.length]);

  function navigate(r: Result) {
    setOpen(false);
    switch (r.kind) {
      case "task":
        router.push(`/tareas?task=${r.id}`);
        break;
      case "client":
        router.push(`/clientes?client=${r.id}`);
        break;
      case "project":
        router.push(`/tareas?project=${r.id}`);
        break;
      case "document":
        router.push(`/documentos/${r.id}`);
        break;
      case "action":
        router.push(r.href);
        break;
      default: {
        // Resultados extra del endpoint semántico (p. ej. "comment")
        // que el lexical no devuelve. Saltamos a la entidad padre.
        const anyR = r as any;
        if (anyR.kind === "comment" && anyR.parentType === "TASK") {
          router.push(`/tareas?task=${anyR.parentId}`);
        }
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tareas, clientes, documentos, acciones…"
            className="flex-1 text-sm focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[index];
                if (r) navigate(r);
              }
            }}
          />
          <kbd className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 border border-slate-200">
            ESC
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500 italic">
              {q ? "Sin coincidencias." : "Empieza a escribir…"}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                navigate(r);
              }}
              onMouseEnter={() => setIndex(i)}
              className={
                "w-full px-4 py-2 flex items-center gap-3 text-left text-sm " +
                (i === index ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50")
              }
            >
              <ResultIcon r={r} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{titleOf(r)}</span>
                {subtitleOf(r) && (
                  <span className="block truncate text-[11px] text-slate-500">{subtitleOf(r)}</span>
                )}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {labelOf(r)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t text-[11px] text-slate-500 flex items-center justify-between bg-slate-50">
          <span>↑/↓ navegar · Enter abrir</span>
          <span>
            <kbd className="bg-white border rounded px-1">⌘</kbd>
            <kbd className="bg-white border rounded px-1 ml-1">K</kbd>{" "}
            para alternar
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultIcon({ r }: { r: Result }) {
  const cls = "h-4 w-4 text-slate-400 shrink-0";
  if (r.kind === "task") return <CheckSquare className={cls} />;
  if (r.kind === "client") return <Users className={cls} />;
  if (r.kind === "project") return <Briefcase className={cls} />;
  if (r.kind === "document") return <FileText className={cls} />;
  const Icon = r.icon ?? Home;
  return <Icon className={cls} />;
}

function titleOf(r: Result): string {
  if (r.kind === "task" || r.kind === "document" || r.kind === "action") return r.title;
  return r.name;
}
function subtitleOf(r: Result): string | null {
  const anyR = r as any;
  // Resultados del endpoint semántico traen `subtitle` y `snippet`;
  // los del lexical traen `clientName`. Soportamos ambos para que
  // los dos modos de búsqueda compartan la misma UI.
  if (anyR.subtitle) return anyR.subtitle;
  if (anyR.snippet) return anyR.snippet;
  if (r.kind === "task") return (r as any).clientName ?? null;
  if (r.kind === "project") return (r as any).clientName ?? null;
  return null;
}
function labelOf(r: Result): string {
  return r.kind;
}
