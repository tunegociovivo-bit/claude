"use client";

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  TextQuote,
  Type
} from "lucide-react";

type CommandItem = {
  title: string;
  description: string;
  icon: any;
  command: (props: { editor: any; range: any }) => void;
};

export const commandItems: CommandItem[] = [
  {
    title: "Texto",
    description: "Empieza a escribir con texto plano",
    icon: Type,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run()
  },
  {
    title: "Título 1",
    description: "Sección grande",
    icon: Heading1,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run()
  },
  {
    title: "Título 2",
    description: "Subsección",
    icon: Heading2,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run()
  },
  {
    title: "Título 3",
    description: "Subsubsección",
    icon: Heading3,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run()
  },
  {
    title: "Lista",
    description: "Lista con bullets",
    icon: List,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    title: "Lista numerada",
    description: "Lista 1. 2. 3.",
    icon: ListOrdered,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    title: "Tareas",
    description: "Lista con checkboxes",
    icon: CheckSquare,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run()
  },
  {
    title: "Cita",
    description: "Bloque de cita",
    icon: Quote,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  {
    title: "Código",
    description: "Bloque de código",
    icon: Code,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  },
  {
    title: "Divisor",
    description: "Línea horizontal",
    icon: Minus,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  }
];

export const CommandsList = forwardRef<any, { items: CommandItem[]; command: (item: CommandItem) => void }>(
  function CommandsListInner({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      }
    }));

    return (
      <div className="bg-white border rounded-lg shadow-lg p-1 w-72 max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-500">Sin resultados</div>
        ) : (
          items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                onClick={() => command(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded text-left ${
                  idx === selectedIndex ? "bg-brand-50" : ""
                }`}
              >
                <div className="h-8 w-8 grid place-items-center rounded border bg-white text-slate-600">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-slate-500">{item.description}</div>
                </div>
              </button>
            );
          })
        )}
      </div>
    );
  }
);

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }: any) => props.command({ editor, range })
      }
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) =>
          commandItems
            .filter((i) => i.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 10),
        render: () => {
          let component: ReactRenderer<any>;
          let popup: TippyInstance[];

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(CommandsList, { props, editor: props.editor });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start"
              });
            },
            onUpdate(props: any) {
              component?.updateProps(props);
              if (!props.clientRect) return;
              popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
            },
            onKeyDown(props: any) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props);
            },
            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            }
          };
        }
      })
    ];
  }
});
