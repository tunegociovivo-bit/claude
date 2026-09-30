import { describe, expect, it } from "vitest";
import {
  focusOnMention,
  hasVisibleContent,
  richTextToEmailHtml,
  richTextToPlainText
} from "@/lib/notifications/rich-text";
import { buildMentionEmail } from "@/lib/notifications/mention-email";

// Comentario real que llegó en crudo por email (captura del 30/09/2026).
const PAULA_COMMENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "mention", attrs: { id: "cmp6hx8on0000sbc8tagp7omf", label: "David Rios NV", mentionSuggestionChar: "@" } },
        { type: "text", text: " " },
        { type: "mention", attrs: { id: "cmp80853y000h9ymr08vf1ylo", label: "Alejandro Marcos", mentionSuggestionChar: "@" } },
        { type: "text", text: "  " },
        { type: "hardBreak" },
        { type: "text", text: "Para la web de Aitziber:" }
      ]
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "He ampliado información en estas tres páginas:" },
        { type: "hardBreak" },
        {
          type: "text",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://aitziberyaguecortazar.com/servicios/cirugia-maxilofacial/",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
                title: null
              }
            }
          ],
          text: "https://aitziberyaguecortazar.com/servicios/cirugia-maxilofacial/"
        }
      ]
    },
    { type: "paragraph" }
  ]
};
const ALEJANDRO = "cmp80853y000h9ymr08vf1ylo";

describe("richTextToEmailHtml", () => {
  it("no deja JSON en el correo y renderiza menciones, saltos y enlaces", () => {
    const { output, truncated } = richTextToEmailHtml(JSON.stringify(PAULA_COMMENT), { highlightUserId: ALEJANDRO });
    expect(truncated).toBe(false);
    expect(output).not.toContain('"type"');
    expect(output).not.toContain("mentionSuggestionChar");
    expect(output).toContain("@David Rios NV");
    expect(output).toContain("@Alejandro Marcos");
    expect(output).toContain("<br>");
    expect(output).toContain("Para la web de Aitziber:");
    expect(output).toContain('href="https://aitziberyaguecortazar.com/servicios/cirugia-maxilofacial/"');
    // El destinatario se resalta distinto al resto de mencionados.
    expect(output).toMatch(/background:#3f47d8;color:#ffffff;[^"]*">@Alejandro Marcos/);
    expect(output).toMatch(/background:#eaeefe;[^"]*">@David Rios NV/);
    // El párrafo vacío final de TipTap no genera hueco.
    expect(output.endsWith("&nbsp;</p>")).toBe(false);
  });

  it("escapa HTML y bloquea enlaces javascript:", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "<script>alert(1)</script>" },
            { type: "text", text: "clic", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }
          ]
        }
      ]
    };
    const { output } = richTextToEmailHtml(doc);
    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("javascript:");
  });

  it("corta textos largos y lo indica", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "palabra ".repeat(500) }] }] };
    const { output, truncated } = richTextToEmailHtml(doc, { maxChars: 100 });
    expect(truncated).toBe(true);
    expect(output).toContain("…");
    expect(output.length).toBeLessThan(400);
  });

  it("acepta texto plano legacy (Asana)", () => {
    const { output } = richTextToEmailHtml("Hola @lucia\nsegunda línea");
    expect(output).toContain("Hola @lucia");
    expect(output).toContain("segunda línea");
  });

  it("renderiza listas, negritas y encabezados", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Pendiente" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Uno", marks: [{ type: "bold" }] }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Dos" }] }] }
          ]
        }
      ]
    };
    const { output } = richTextToEmailHtml(doc);
    expect(output).toContain("Pendiente");
    expect(output).toContain("<ul");
    expect(output).toContain("<strong>Uno</strong>");
  });
});

describe("richTextToPlainText", () => {
  it("genera texto legible para WhatsApp", () => {
    const { output } = richTextToPlainText(PAULA_COMMENT, { format: "whatsapp" });
    expect(output).toBe(
      "@David Rios NV @Alejandro Marcos\nPara la web de Aitziber:\n\nHe ampliado información en estas tres páginas:\nhttps://aitziberyaguecortazar.com/servicios/cirugia-maxilofacial/"
    );
  });

  it("añade la URL cuando el texto del enlace es distinto", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "la ficha", marks: [{ type: "link", attrs: { href: "https://ejemplo.com/ficha" } }] }] }]
    };
    expect(richTextToPlainText(doc).output).toBe("la ficha (https://ejemplo.com/ficha)");
  });

  it("formatea listas numeradas y negritas en WhatsApp", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primero ", marks: [{ type: "bold" }] }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Segundo" }] }] }
          ]
        }
      ]
    };
    expect(richTextToPlainText(doc, { format: "whatsapp" }).output).toBe("1. *Primero*\n2. Segundo");
  });
});

describe("focusOnMention / hasVisibleContent", () => {
  it("se queda solo con los bloques donde aparece el destinatario", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro larga" }] },
        { type: "paragraph", content: [{ type: "mention", attrs: { id: "u1", label: "Ana" } }, { type: "text", text: " revisa esto" }] },
        { type: "paragraph", content: [{ type: "text", text: "Otra cosa" }] }
      ]
    };
    const focused = focusOnMention(doc, "u1");
    expect(focused.content).toHaveLength(1);
    expect(richTextToPlainText(focused).output).toBe("@Ana revisa esto");
    // Sin coincidencias devuelve el doc completo.
    expect(focusOnMention(doc, "otro").content).toHaveLength(3);
  });

  it("detecta cuerpos vacíos", () => {
    expect(hasVisibleContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(hasVisibleContent("")).toBe(false);
    expect(hasVisibleContent(PAULA_COMMENT)).toBe(true);
  });
});

describe("buildMentionEmail", () => {
  it("monta asunto, HTML y texto sin JSON", () => {
    const excerpt = richTextToEmailHtml(PAULA_COMMENT, { highlightUserId: ALEJANDRO });
    const text = richTextToPlainText(PAULA_COMMENT);
    const email = buildMentionEmail({
      actorName: "Paula Estevez",
      whereLabel: "un comentario",
      sourceTitle: "aitziber",
      sourceKindLabel: "Tarea",
      url: "https://hub.negociovivo.app/tareas?task=abc",
      ctaLabel: "Ver comentario",
      excerptHtml: excerpt.output,
      excerptTruncated: excerpt.truncated,
      excerptText: text.output
    });
    expect(email.subject).toBe("Paula Estevez te ha mencionado en «aitziber»");
    expect(email.html).toContain(">PE<");
    expect(email.html).toContain("Ver comentario →");
    expect(email.html).toContain("https://hub.negociovivo.app/tareas?task=abc");
    expect(email.html).not.toContain("mentionSuggestionChar");
    expect(email.text).toContain("Para la web de Aitziber:");
    expect(email.text).not.toContain('"type"');
  });
});
