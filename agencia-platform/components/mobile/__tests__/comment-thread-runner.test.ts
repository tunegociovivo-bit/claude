import { describe, expect, it } from "vitest";
import { inspectCommentThreadNavigation, postCommentThreadMessage } from "../comment-thread-runner";
import { collapsedReplyPreviews } from "../facebook-conversation-ui";
import type { CommentThreadMessage } from "@/lib/mobile/comment-thread";

const message: CommentThreadMessage = {
  kind: "comment_thread", version: 1, threadId: "7f1c1a52-6a55-4e38-9b44-1b0b2a8a3c11", order: 1, total: 2,
  postUrl: "https://www.facebook.com/post/1", guide: "g", author: "A", mode: "comment", replyToOrder: null,
  replyToAuthor: null, replyToText: null, parentJobId: null, previousJobId: null,
  text: "Estoy pensando en invertir en una franquicia", outcome: "pending", detail: null
};

function screen(nodes: Array<{ text?: string; desc?: string; cls?: string; clickable?: boolean; y: number }>) {
  return `<hierarchy>${nodes.map((node) => `<node text="${node.text ?? ""}" content-desc="${node.desc ?? ""}" package="com.facebook.katana" resource-id="" class="${node.cls ?? "android.view.ViewGroup"}" clickable="${node.clickable ?? true}" focused="false" checked="false" bounds="[0,${node.y}][1080,${node.y + 80}]" />`).join("")}</hierarchy>`;
}

function deps(screens: Array<string | Error>) {
  const taps: number[] = [];
  return {
    taps,
    deps: {
      openUrl: async () => {}, wait: async () => {}, paste: async () => {}, scroll: async () => {}, beforeSend: async () => {},
      tap: async (point: { y: number }) => { taps.push(point.y); },
      read: async () => { const next = screens.shift(); if (next instanceof Error) throw next; return next ?? screen([]); }
    }
  };
}

const parentText = "Esta es la respuesta original.";
const collapsedReply = `<hierarchy>
<node package="com.facebook.katana" class="android.view.ViewGroup" text="" content-desc="Ana, ${parentText}" clickable="true" bounds="[0,605][480,659]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="Ana" content-desc="Ana" bounds="[135,614][262,650]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="${parentText}" content-desc="${parentText}" bounds="[262,620][462,644]" />
</hierarchy>`;
const expandedReply = `<hierarchy>
<node package="com.facebook.katana" class="android.widget.ImageView" text="" content-desc="Foto de perfil de Ana" bounds="[18,117][78,177]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Ana" bounds="[84,117][182,145]" />
<node package="com.facebook.katana" class="android.widget.Button" text="${parentText}" bounds="[90,149][462,267]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Responder al comentario de Ana" bounds="[78,270][147,315]" />
</hierarchy>`;

describe("respuestas plegadas de Facebook", () => {
  it("comprueba el destinatario sin escribir, preparar el envío ni pulsar Responder", async () => {
    const { deps: d, taps } = deps([screen([]), collapsedReply, expandedReply]);
    d.paste = async () => { throw new Error("No debe escribir"); };
    d.beforeSend = async () => { throw new Error("No debe preparar un envío"); };
    const result = await inspectCommentThreadNavigation({ ...message, mode: "reply", replyToText: parentText }, d);
    expect(result).toContain(parentText);
    expect(taps).toEqual([632]);
  });
  it("espera la foto vacía y abre comentarios cuando su botón aparece después", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([]), screen([]), screen([]),
      screen([{ text: "Comentar", y: 100 }]),
      screen([{ text: "Más pertinentes", y: 200 }]),
      screen([{ text: "Todos los comentarios", y: 300 }]), expandedReply,
      screen([{ text: "Ana", cls: "android.widget.EditText", y: 700 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 700 }, { text: "Enviar", y: 900 }]),
      screen([{ text: message.text, y: 500 }])
    ]);
    d.scroll = async () => { throw new Error("No debe desplazar una pantalla todavía vacía"); };
    expect((await postCommentThreadMessage({ ...message, mode: "reply", replyToText: parentText }, d)).outcome).toBe("sent");
    expect(taps).toEqual([140, 240, 340, 293, 740, 940]);
  });

  it("abre Ver una respuesta y prefiere Todos los comentarios a Más recientes", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([]), screen([]),
      screen([{ text: "Más pertinentes", y: 100 }]),
      screen([{ text: "Más recientes", y: 200 }, { text: "Todos los comentarios", y: 300 }]),
      screen([{ text: "Ver una respuesta", y: 400 }]), expandedReply,
      screen([{ text: "Ana", cls: "android.widget.EditText", y: 700 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 700 }, { text: "Enviar", y: 900 }]),
      screen([{ text: message.text, y: 500 }])
    ]);
    expect((await postCommentThreadMessage({ ...message, mode: "reply", replyToText: parentText }, d)).outcome).toBe("sent");
    expect(taps).toEqual([140, 340, 440, 293, 740, 940]);
  });

  it("comprueba un envío incierto detrás de Ver una respuesta sin reenviar", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([{ text: "Comentar", y: 100 }]),
      screen([{ text: "Ver una respuesta", y: 400 }]), screen([{ text: message.text, y: 500 }])
    ]);
    expect((await postCommentThreadMessage({ ...message, outcome: "review" }, d)).outcome).toBe("sent");
    expect(taps).toEqual([140, 440]);
  });

  it("abre la vista previa y después usa el botón de responder del comentario exacto", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([]), screen([]), collapsedReply, expandedReply,
      screen([{ text: "Ana", cls: "android.widget.EditText", y: 700 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 700 }, { text: "Enviar", y: 900 }]),
      screen([{ text: message.text, y: 500 }])
    ]);
    expect((await postCommentThreadMessage({ ...message, mode: "reply", replyToText: parentText }, d)).outcome).toBe("sent");
    expect(taps).toEqual([632, 293, 740, 940]);
  });

  it("no convierte texto genérico o una fila no pulsable en vista previa", () => {
    expect(collapsedReplyPreviews(collapsedReply)).toHaveLength(1);
    expect(collapsedReplyPreviews(collapsedReply.replace('clickable="true"', 'clickable="false"'))).toEqual([]);
    expect(collapsedReplyPreviews(collapsedReply.replace(`Ana, ${parentText}`, "Otra descripción"))).toEqual([]);
  });

  it("encuentra un envío anterior oculto dentro de una respuesta plegada sin reenviarlo", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([{ text: "Comentar", y: 100 }]), collapsedReply,
      screen([{ text: message.text, y: 500 }])
    ]);
    let pasted = false;
    d.paste = async () => { pasted = true; };
    expect((await postCommentThreadMessage({ ...message, outcome: "review" }, d)).outcome).toBe("sent");
    expect(taps).toEqual([140, 632]);
    expect(pasted).toBe(false);
  });
});

describe("publicar mensaje de conversación", () => {
  it("toca «Comentar», reintenta lecturas fallidas y publica", async () => {
    const posted = screen([{ text: message.text, cls: "android.widget.TextView", y: 900 }]);
    const { deps: d, taps } = deps([
      screen([{ text: "Inicio", y: 100 }]), // app chooser check (pre-scan)
      screen([{ text: "Inicio", y: 100 }]), // pre-scan: nada publicado ni botón de comentarios
      new Error("uiautomator ocupado"),
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ desc: "Comentar, botón", y: 1500 }]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 2000 }, { desc: "Enviar", y: 2000 }]),
      posted
    ]);
    const result = await postCommentThreadMessage(message, d);
    expect(result.outcome).toBe("sent");
    expect(taps).toEqual([1540, 2040, 2040]);
  });

  it("si la comprobación tras enviar falla, queda en revisión y no lanza error (no duplica)", async () => {
    const { deps: d } = deps([
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 2000 }, { text: "Publicar", y: 2000 }]),
      new Error("x"), new Error("x"), new Error("x")
    ]);
    const result = await postCommentThreadMessage(message, d);
    expect(result.outcome).toBe("review");
  });
});

describe("selector «Abrir con» de app dual", () => {
  it("elige la primera app Facebook y continúa", async () => {
    const chooser = `<hierarchy><node text="Abrir con" content-desc="" package="android" resource-id="" class="android.widget.TextView" clickable="false" focused="false" checked="false" bounds="[0,1200][1080,1260]" /><node text="Facebook" content-desc="" package="android" resource-id="" class="android.widget.TextView" clickable="true" focused="false" checked="false" bounds="[100,1400][300,1450]" /><node text="Facebook" content-desc="" package="android" resource-id="" class="android.widget.TextView" clickable="true" focused="false" checked="false" bounds="[700,1400][900,1450]" /></hierarchy>`;
    const { deps: d, taps } = deps([
      chooser,
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Inicio", y: 100 }]),
      chooser,
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 2000 }, { desc: "Enviar", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.TextView", y: 900 }])
    ]);
    const result = await postCommentThreadMessage(message, d);
    expect(taps[0]).toBe(1425);
    expect(taps[1]).toBe(1425);
    expect(result.outcome).toBe("sent");
  });
});

describe("anti-duplicados", () => {
  it("nunca vuelve a enviar un resultado incierto aunque no encuentre el texto", async () => {
    const { deps: d, taps } = deps([screen([]), screen([])]);
    let pasted = false;
    d.paste = async () => { pasted = true; };
    expect((await postCommentThreadMessage({ ...message, outcome: "review" }, d)).outcome).toBe("review");
    expect(pasted).toBe(false);
    expect(taps).toEqual([]);
  });

  it("no confunde un texto que solo comparte el prefijo con el mensaje completo", async () => {
    const { deps: d } = deps([screen([]), screen([{ text: message.text + " pero no ahora", y: 900 }])]);
    expect((await postCommentThreadMessage({ ...message, outcome: "review" }, d)).outcome).toBe("review");
  });

  it("no pulsa Enviar si no puede guardar antes la intención", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([]), screen([]),
      screen([{ text: "Escribe un comentario", cls: "android.widget.EditText", y: 1000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 1000 }, { text: "Enviar", y: 1500 }])
    ]);
    d.beforeSend = async () => { throw new Error("Sin conexión al servidor"); };
    await expect(postCommentThreadMessage(message, d)).rejects.toThrow("Sin conexión");
    expect(taps).not.toContain(1540);
  });
  it("no vuelve a escribir un comentario que ya está publicado", async () => {
    const { deps: d, taps } = deps([
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: message.text, cls: "android.widget.TextView", y: 900 }, { text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }])
    ]);
    // el texto aparece en el primer vistazo: no se abre el campo ni se envía nada
    const result = await postCommentThreadMessage(message, d);
    expect(result.outcome).toBe("sent");
    expect(result.detail).toContain("ya estaba publicado");
    expect(taps).toEqual([]);
  });
});
