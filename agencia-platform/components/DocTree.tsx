"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Plus, FileText } from "lucide-react";

type Node = { id: string; title: string; icon: string | null; children: Node[] };

function TreeNode({ node, level, onAddChild }: { node: Node; level: number; onAddChild: (parentId: string) => void }) {
  const [open, setOpen] = useState(level === 0);
  const has = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-slate-50 group"
        style={{ paddingLeft: `${level * 12 + 6}px` }}
      >
        <button
          onClick={() => setOpen(!open)}
          className={`h-4 w-4 grid place-items-center text-slate-400 ${has ? "" : "invisible"}`}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Link href={`/documentos/${node.id}`} className="flex items-center gap-2 flex-1 min-w-0 text-sm">
          <span className="shrink-0">{node.icon && /\p{Emoji}/u.test(node.icon) ? node.icon : "📄"}</span>
          <span className="truncate">{node.title}</span>
        </Link>
        <button
          onClick={() => onAddChild(node.id)}
          className="opacity-0 group-hover:opacity-100 h-5 w-5 grid place-items-center rounded hover:bg-slate-200 text-slate-500"
          title="Añadir subpágina"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {has && open && (
        <div>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} level={level + 1} onAddChild={onAddChild} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocTree() {
  const [tree, setTree] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/v1/documents/tree");
      if (r.ok) {
        const data = await r.json();
        setTree(data.tree);
      }
    } finally {
      setLoading(false);
    }
  }

  async function add(parentId: string | null) {
    const r = await fetch("/api/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Sin título", parentId })
    });
    if (r.ok) {
      const created = await r.json();
      window.location.href = `/documentos/${created.id}`;
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div className="text-xs text-slate-400 px-2 py-1">Cargando…</div>;

  if (tree.length === 0) {
    return (
      <button
        onClick={() => add(null)}
        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-500 hover:bg-slate-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Crear primera página
      </button>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((n) => (
        <TreeNode key={n.id} node={n} level={0} onAddChild={(parentId) => add(parentId)} />
      ))}
      <button
        onClick={() => add(null)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-slate-500 hover:bg-slate-50"
      >
        <Plus className="h-3 w-3" />
        Nueva página
      </button>
    </div>
  );
}
