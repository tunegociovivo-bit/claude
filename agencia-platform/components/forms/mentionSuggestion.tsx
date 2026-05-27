"use client";

import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export type MentionCandidate = {
  id: string;
  name: string | null;
  email: string;
};

type Item = MentionCandidate;

/**
 * Lista flotante de candidatos a @mención. Sin dependencias externas
 * (sin tippy/floating-ui) — posicionada manualmente vía clientRect que
 * nos pasa TipTap suggestion.
 */
const MentionList = forwardRef(function MentionList(
  props: SuggestionProps<Item>,
  ref
) {
  const [index, setIndex] = useState(0);
  const items = props.items;

  useEffect(() => setIndex(0), [items]);

  function pick(i: number) {
    const item = items[i];
    if (!item) return;
    props.command({ id: item.id, label: item.name ?? item.email } as any);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown(p: SuggestionKeyDownProps) {
      if (p.event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (p.event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
        return true;
      }
      if (p.event.key === "Enter") {
        pick(index);
        return true;
      }
      return false;
    }
  }));

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-md border shadow-lg p-2 text-xs text-slate-500">
        Sin coincidencias
      </div>
    );
  }

  return (
    <div className="bg-white rounded-md border shadow-lg py-1 min-w-[200px] max-h-64 overflow-auto">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            pick(i);
          }}
          onMouseEnter={() => setIndex(i)}
          className={
            "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 " +
            (i === index ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50")
          }
        >
          <span className="h-6 w-6 rounded-full bg-slate-200 grid place-items-center text-[10px] font-semibold text-slate-600 shrink-0">
            {(item.name ?? item.email).slice(0, 2).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0">
            <div className="truncate font-medium">{item.name ?? item.email}</div>
            {item.name && (
              <div className="truncate text-[11px] text-slate-500">{item.email}</div>
            )}
          </span>
        </button>
      ))}
    </div>
  );
});

export function buildMentionSuggestion(
  getCandidates: () => MentionCandidate[]
): Omit<SuggestionOptions<Item>, "editor"> {
  return {
    items: ({ query }) => {
      const q = query.toLowerCase();
      const list = getCandidates();
      return list
        .filter((c) => {
          const hay = `${c.name ?? ""} ${c.email}`.toLowerCase();
          return q === "" || hay.includes(q);
        })
        .slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<any, SuggestionProps<Item>> | null = null;
      let host: HTMLDivElement | null = null;

      function place(rect: DOMRect | null) {
        if (!host || !rect) return;
        host.style.left = `${rect.left + window.scrollX}px`;
        host.style.top = `${rect.bottom + window.scrollY + 4}px`;
      }

      return {
        onStart(p) {
          component = new ReactRenderer(MentionList as any, { props: p, editor: p.editor as Editor });
          host = document.createElement("div");
          host.style.position = "absolute";
          host.style.zIndex = "100";
          host.appendChild(component.element);
          document.body.appendChild(host);
          place(p.clientRect?.() ?? null);
        },
        onUpdate(p) {
          component?.updateProps(p);
          place(p.clientRect?.() ?? null);
        },
        onKeyDown(p) {
          if (p.event.key === "Escape") {
            host?.remove();
            host = null;
            return true;
          }
          return (component?.ref as any)?.onKeyDown?.(p) ?? false;
        },
        onExit() {
          host?.remove();
          host = null;
          component?.destroy();
          component = null;
        }
      };
    }
  };
}
