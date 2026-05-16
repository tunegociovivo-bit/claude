import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { slashSuggestion } from "./slashSuggestion";

/**
 * Extension TipTap que activa el menú de slash commands. Escribe "/"
 * en una línea vacía (o en mitad de un párrafo) y aparece el menú
 * con bloques: encabezados, listas, cita, divider, etc.
 *
 * Se monta en RichTextEditor para que descripciones de tarea y
 * documentos tengan la misma UX que CommentEditor.
 */
export const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...slashSuggestion
      })
    ];
  }
});
