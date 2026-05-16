"use client";

import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Heading1, Heading2, Heading3, List, ListChecks, ListOrdered, Quote, Code, Minus, Image as ImageIcon, Link as LinkIcon } from "lucide-react";

type SlashItem = {
  id: string;
  title: string;
  hint: string;
  icon: any;
  run: (editor: Editor) => void;
  keywords: string[];
};

const ITEMS: SlashItem[] = [
  {
    id: "h1",
    title: "Encabezado 1",
    hint: "Título grande",
    icon: Heading1,
    keywords: ["h1", "titulo", "heading"],
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    id: "h2",
    title: "Encabezado 2",
    hint: "Subtítulo",
    icon: Heading2,
    keywords: ["h2", "subtitulo"],
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    id: "h3",
    title: "Encabezado 3",
    hint: "Sub-subtítulo",
    icon: Heading3,
    keywords: ["h3"],
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run()
  },
  {
    id: "ul",
    title: "Lista",
    hint: "Bullets",
    icon: List,
    keywords: ["lista", "bullet", "ul"],
    run: (e) => e.chain().focus().toggleBulletList().run()
  },
  {
    id: "ol",
    title: "Lista numerada",
    hint: "1, 2, 3…",
    icon: ListOrdered,
    keywords: ["numerada", "ol", "orden"],
    run: (e) => e.chain().focus().toggleOrderedList().run()
  },
  {
    id: "task",
    title: "Lista de tareas",
    hint: "Checkboxes",
    icon: ListChecks,
    keywords: ["task", "todo", "checklist", "tareas"],
    run: (e) => (e.chain().focus() as any).toggleTaskList().run()
  },
  {
    id: "quote",
    title: "Cita",
    hint: "Bloque citado",
    icon: Quote,
    keywords: ["cita", "quote", "blockquote"],
    run: (e) => e.chain().focus().toggleBlockquote().run()
  },
  {
    id: "code",
    title: "Bloque de código",
    hint: "Monospace + indent",
    icon: Code,
    keywords: ["code", "codigo", "pre"],
    run: (e) => e.chain().focus().toggleCodeBlock().run()
  },
  {
    id: "hr",
    title: "Divider",
    hint: "Línea horizontal",
    icon: Minus,
    keywords: ["hr", "divider", "linea", "separador"],
    run: (e) => e.chain().focus().setHorizontalRule().run()
  },
  {
    id: "link",
    title: "Enlace",
    hint: "Convierte la selección en link",
    icon: LinkIcon,
    keywords: ["link", "url", "enlace"],
    run: (e) => {
      const url = window.prompt("URL");
      if (url) e.chain().focus().setLink({ href: url }).run();
    }
  },
  {
    id: "image",
    title: "Imagen por URL",
    hint: "Insertar imagen vía URL pública",
    icon: ImageIcon,
    keywords: ["img", "image", "imagen", "foto"],
    run: (e) => {
      const url = window.prompt("URL de la imagen");
      if (url) (e.chain().focus() as any).setImage({ src: url }).run();
    }
  }
];

const SlashList = forwardRef(function SlashList(
  props: SuggestionProps<SlashItem>,
  ref
) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [props.items]);

  function pick(i: number) {
    const it = props.items[i];
    if (!it) return;
    // Borra el "/" + texto del trigger antes de aplicar el comando, si
    // no se queda escrito en el doc.
    (props as any).command(it);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown(p: SuggestionKeyDownProps) {
      if (p.event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(props.items.length, 1));
        return true;
      }
      if (p.event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + Math.max(props.items.length, 1)) % Math.max(props.items.length, 1));
        return true;
      }
      if (p.event.key === "Enter") {
        pick(index);
        return true;
      }
      return false;
    }
  }));

  if (props.items.length === 0) {
    return (
      <div className="bg-white rounded-md border shadow-lg p-2 text-xs text-slate-500">
        Sin bloques
      </div>
    );
  }

  return (
    <div className="bg-white rounded-md border shadow-lg py-1 min-w-[260px] max-h-72 overflow-auto">
      {props.items.map((it, i) => (
        <button
          key={it.id}
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
          <it.icon className="h-4 w-4 text-slate-500 shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block truncate font-medium">{it.title}</span>
            <span className="block truncate text-[11px] text-slate-500">{it.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

export const slashSuggestion: Omit<SuggestionOptions<SlashItem>, "editor"> = {
  char: "/",
  startOfLine: false,
  items: ({ query }) => {
    const q = query.toLowerCase();
    return ITEMS.filter((it) => {
      if (!q) return true;
      if (it.title.toLowerCase().includes(q)) return true;
      return it.keywords.some((k) => k.includes(q));
    });
  },
  command: ({ editor, range, props }) => {
    // Borra el "/" + texto del trigger y luego ejecuta el comando del item.
    editor.chain().focus().deleteRange(range).run();
    (props as SlashItem).run(editor as Editor);
  },
  render: () => {
    let component: ReactRenderer<any, SuggestionProps<SlashItem>> | null = null;
    let host: HTMLDivElement | null = null;

    function place(rect: DOMRect | null) {
      if (!host || !rect) return;
      host.style.left = `${rect.left + window.scrollX}px`;
      host.style.top = `${rect.bottom + window.scrollY + 4}px`;
    }

    return {
      onStart(p) {
        component = new ReactRenderer(SlashList as any, { props: p, editor: p.editor as Editor });
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
