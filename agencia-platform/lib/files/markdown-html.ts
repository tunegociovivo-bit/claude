/**
 * Conversor minimal Markdown → HTML estilizado, sin dependencias
 * externas. Cubre lo que Sonia genera en informes: headers, listas,
 * tablas pipe, code, negrita/cursiva, links, separadores y párrafos.
 *
 * El HTML resultante incluye estilos inline pensados para que se
 * vea bien tanto abierto en navegador como impreso a PDF
 * (Ctrl+P → "Guardar como PDF") — A4 con márgenes razonables y
 * tipografía sans-serif limpia.
 *
 * NO pretende ser un parser MD compliant. Es deliberadamente
 * pragmático: 60 líneas, cero deps, cobertura ~80% de los casos
 * habituales de Sonia.
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function inline(s: string): string {
  let out = esc(s);
  // Code inline `…`
  out = out.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 5px;border-radius:3px;font-size:0.9em;">$1</code>');
  // Bold **…**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic *…* (no greedy)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#3f47d8;text-decoration:underline;">$1</a>');
  return out;
}

export function markdownToHtmlBody(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Headers # … ######
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      const sizes: Record<number, string> = {
        1: "1.8em",
        2: "1.4em",
        3: "1.2em",
        4: "1.05em",
        5: "1em",
        6: "0.9em"
      };
      out.push(
        `<h${level} style="margin:1.2em 0 0.4em;font-size:${sizes[level]};color:#0f172a;font-weight:700;border-bottom:${level <= 2 ? "1px solid #e2e8f0;padding-bottom:0.2em" : "none"};">${inline(h[2])}</h${level}>`
      );
      i++;
      continue;
    }

    // Separador ---
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr style="border:none;border-top:1px solid #cbd5e1;margin:1.5em 0;" />');
      i++;
      continue;
    }

    // Tabla pipe — detectamos por header + separador "|---|"
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1])
    ) {
      const header = splitPipe(line);
      i += 2; // saltamos header + separador
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitPipe(lines[i]));
        i++;
      }
      out.push(
        '<table style="width:100%;border-collapse:collapse;margin:0.8em 0;font-size:0.92em;">' +
          "<thead><tr>" +
          header
            .map(
              (h) =>
                `<th style="border:1px solid #cbd5e1;padding:6px 10px;background:#f8fafc;text-align:left;font-weight:600;">${inline(h)}</th>`
            )
            .join("") +
          "</tr></thead><tbody>" +
          rows
            .map(
              (r) =>
                "<tr>" +
                r
                  .map(
                    (c) =>
                      `<td style="border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">${inline(c)}</td>`
                  )
                  .join("") +
                "</tr>"
            )
            .join("") +
          "</tbody></table>"
      );
      continue;
    }

    // Lista no ordenada -/* (consume líneas seguidas)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        '<ul style="margin:0.6em 0;padding-left:1.4em;">' +
          items.map((it) => `<li style="margin:0.2em 0;">${inline(it)}</li>`).join("") +
          "</ul>"
      );
      continue;
    }

    // Lista ordenada 1. 2. 3.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(
        '<ol style="margin:0.6em 0;padding-left:1.6em;">' +
          items.map((it) => `<li style="margin:0.2em 0;">${inline(it)}</li>`).join("") +
          "</ol>"
      );
      continue;
    }

    // Code block ```…```
    if (line.startsWith("```")) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:6px;overflow-x:auto;font-size:0.85em;line-height:1.5;margin:0.8em 0;"><code>${esc(buf.join("\n"))}</code></pre>`
      );
      continue;
    }

    // Línea vacía → fin de párrafo
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Párrafo (agrupa líneas seguidas no vacías)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|>\s|\s*[-*]\s|\s*\d+\.\s|```|---+)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      `<p style="margin:0.6em 0;line-height:1.6;">${inline(para.join(" "))}</p>`
    );
  }
  return out.join("\n");
}

function splitPipe(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((s) => s.trim());
}

/**
 * Envuelve un body HTML en un documento completo con título,
 * tipografía y estilos de página A4 listos para "Imprimir → PDF"
 * desde el navegador.
 */
export function wrapAsReportHtml(opts: {
  title: string;
  bodyHtml: string;
  subtitle?: string;
  footer?: string;
}): string {
  const generated = new Date().toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; color: #0f172a; max-width: 800px; margin: 0 auto; padding: 28px; line-height: 1.55; }
  .doc-header { border-bottom: 2px solid #3f47d8; padding-bottom: 10px; margin-bottom: 24px; }
  .doc-header h1 { margin: 0 0 4px; color: #0f172a; font-size: 1.8em; }
  .doc-header .subtitle { color: #64748b; font-size: 0.95em; }
  .doc-header .meta { color: #94a3b8; font-size: 0.8em; margin-top: 6px; }
  .doc-footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.78em; text-align: center; }
  @media print { .doc-header { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="doc-header">
    <h1>${esc(opts.title)}</h1>
    ${opts.subtitle ? `<div class="subtitle">${esc(opts.subtitle)}</div>` : ""}
    <div class="meta">Generado el ${generated} · Negocio Vivo</div>
  </div>
  ${opts.bodyHtml}
  <div class="doc-footer">${esc(opts.footer ?? "Documento generado automáticamente por Sonia (Negocio Vivo Hub)")}</div>
</body>
</html>`;
}
