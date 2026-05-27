"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { useEffect, useRef } from "react";
import { SlashCommands } from "./SlashCommands";
import { buildMentionSuggestion, type MentionCandidate } from "@/components/forms/mentionSuggestion";

/**
 * RichTextEditor reutilizable basado en TipTap.
 * No persiste automáticamente — emite `onChange(json)` y el padre decide.
 * Acepta initialContent como JSON de TipTap o como string (texto plano).
 */
export default function RichTextEditor({
  initialContent,
  onChange,
  placeholder = "Escribe… / para insertar bloques, @ para mencionar.",
  minHeight = 120,
  readOnly = false,
  mentionCandidates = []
}: {
  initialContent?: any;
  onChange?: (content: any) => void;
  placeholder?: string;
  minHeight?: number;
  readOnly?: boolean;
  mentionCandidates?: MentionCandidate[];
}) {
  const candidatesRef = useRef<MentionCandidate[]>(mentionCandidates);
  candidatesRef.current = mentionCandidates;
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      SlashCommands,
      Mention.configure({
        HTMLAttributes: { class: "bg-brand-100 text-brand-700 rounded px-1 py-0.5 text-[12px] font-medium" },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: buildMentionSuggestion(() => candidatesRef.current)
      })
    ],
    content: parseInitial(initialContent),
    onUpdate({ editor }) {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        style: `min-height:${minHeight}px`,
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none " +
          "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-2 " +
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 " +
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
          "[&_p]:my-1.5 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 " +
          "[&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] " +
          "[&_a]:text-brand-600 [&_a]:underline " +
          "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:ml-0 " +
          "[&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:gap-2 [&_li[data-type='taskItem']]:items-start"
      }
    }
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = parseInitial(initialContent);
    if (JSON.stringify(incoming) === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(incoming, false);
  }, [editor, initialContent]);

  return <EditorContent editor={editor} />;
}

function parseInitial(content: any) {
  if (!content) return { type: "doc", content: [{ type: "paragraph" }] };
  if (typeof content === "string") {
    if (content.trim().startsWith("{")) {
      try {
        return JSON.parse(content);
      } catch {
        // fallthrough — tratamos como texto plano
      }
    }
    return {
      type: "doc",
      content: content
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }))
    };
  }
  return content;
}
