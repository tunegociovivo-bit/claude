"use client";

import { useEffect, useRef, useState } from "react";

type Candidate = { id: string; name: string | null; email: string };

/**
 * Textarea con autocompletar de @menciones.
 * Al teclear "@" se abre una lista de usuarios filtrada. Al elegir uno se
 * inserta `@email` en el cursor. El resto es un textarea normal.
 */
export default function MentionTextarea({
  value,
  onChange,
  candidates,
  placeholder,
  rows = 2,
  onSubmitShortcut
}: {
  value: string;
  onChange: (v: string) => void;
  candidates: Candidate[];
  placeholder?: string;
  rows?: number;
  onSubmitShortcut?: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [popup, setPopup] = useState<{
    open: boolean;
    query: string;
    start: number; // posición del @ en el value
    selectedIndex: number;
  }>({ open: false, query: "", start: -1, selectedIndex: 0 });

  function detectMentionAtCursor(text: string, cursor: number) {
    // Buscar el último @ antes del cursor sin espacios/saltos en medio
    const upto = text.slice(0, cursor);
    const at = upto.lastIndexOf("@");
    if (at === -1) return null;
    const slice = upto.slice(at + 1);
    // Si después del @ hay espacio o salto, no estamos mencionando
    if (/\s/.test(slice)) return null;
    return { start: at, query: slice };
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    const cursor = e.target.selectionStart ?? next.length;
    const mention = detectMentionAtCursor(next, cursor);
    if (mention) {
      setPopup({ open: true, query: mention.query, start: mention.start, selectedIndex: 0 });
    } else {
      setPopup((p) => ({ ...p, open: false }));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const filtered = filterCandidates();
    if (popup.open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopup((p) => ({ ...p, selectedIndex: (p.selectedIndex + 1) % filtered.length }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopup((p) => ({
          ...p,
          selectedIndex: (p.selectedIndex - 1 + filtered.length) % filtered.length
        }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(filtered[popup.selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        setPopup((p) => ({ ...p, open: false }));
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmitShortcut) {
      e.preventDefault();
      onSubmitShortcut();
    }
  }

  function filterCandidates() {
    const q = popup.query.toLowerCase();
    if (!q) return candidates.slice(0, 6);
    return candidates
      .filter((c) => {
        const local = c.email.split("@")[0].toLowerCase();
        return (
          c.email.toLowerCase().includes(q) ||
          (c.name ?? "").toLowerCase().includes(q) ||
          local.includes(q)
        );
      })
      .slice(0, 6);
  }

  function pickMention(c: Candidate) {
    const before = value.slice(0, popup.start);
    const afterCursorStart = popup.start + 1 + popup.query.length;
    const after = value.slice(afterCursorStart);
    const inserted = `@${c.email} `;
    const next = before + inserted + after;
    onChange(next);
    setPopup((p) => ({ ...p, open: false }));
    // Reposicionar cursor justo después de la mención
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  const filtered = popup.open ? filterCandidates() : [];

  return (
    <div className="relative w-full">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      {popup.open && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-72 bg-white border rounded-xl shadow-lg overflow-hidden z-30">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500 bg-slate-50 border-b">
            Mencionar a…
          </div>
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickMention(c)}
              className={
                "w-full text-left px-3 py-2 flex items-center gap-2 transition " +
                (i === popup.selectedIndex ? "bg-brand-50" : "hover:bg-slate-50")
              }
            >
              <span className="h-7 w-7 rounded-full bg-brand-500 text-white grid place-items-center text-[10px] font-semibold">
                {(c.name || c.email).slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.name || c.email}</div>
                <div className="text-[11px] text-slate-500 truncate">{c.email}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
