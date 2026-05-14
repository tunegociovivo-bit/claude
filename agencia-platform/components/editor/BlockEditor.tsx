"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { SlashCommand } from "./SlashCommand";
import { useEffect, useRef } from "react";

type Props = {
  documentId: string;
  initialContent?: any;
  readOnly?: boolean;
  onChange?: (content: any) => void;
};

export default function BlockEditor({ documentId, initialContent, readOnly, onChange }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Título";
          return 'Escribe "/" para comandos…';
        }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      SlashCommand
    ],
    content: initialContent || { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate({ editor }) {
      const json = editor.getJSON();
      onChange?.(json);
      if (readOnly) return;
      const serialized = JSON.stringify(json);
      if (serialized === lastSaved.current) return;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await fetch(`/api/v1/documents/${documentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: json })
          });
          lastSaved.current = serialized;
        } catch (e) {
          console.warn("Autosave falló:", e);
        }
      }, 800);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-slate max-w-none focus:outline-none min-h-[400px] " +
          "[&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 " +
          "[&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 " +
          "[&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 " +
          "[&_p]:my-2 [&_p]:text-[15px] [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-600 " +
          "[&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] " +
          "[&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto " +
          "[&_hr]:my-6 [&_hr]:border-slate-200 " +
          "[&_a]:text-brand-600 [&_a]:underline " +
          "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:ml-0 " +
          "[&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:gap-2 [&_li[data-type='taskItem']]:items-start " +
          "[&_li[data-type='taskItem']>label]:flex [&_li[data-type='taskItem']>label]:items-center [&_li[data-type='taskItem']>label]:mt-1"
      }
    }
  });

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return <EditorContent editor={editor} />;
}
