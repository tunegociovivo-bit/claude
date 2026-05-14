/**
 * Convierte el JSON de TipTap (ProseMirror doc) a texto plano para mandarlo al modelo.
 */
export function tiptapToPlainText(doc: any): string {
  if (!doc) return "";
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "text" && node.text) out.push(node.text);
    if (node.type === "heading") out.push("\n");
    if (node.type === "paragraph" || node.type === "blockquote" || node.type === "listItem") out.push("\n");
    if (node.type === "hardBreak") out.push("\n");
    if (Array.isArray(node.content)) for (const c of node.content) walk(c);
    if (node.type === "heading" || node.type === "paragraph") out.push("\n");
  };
  walk(doc);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}
