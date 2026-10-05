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
      openUrl: async () => {}, wait: async () => {}, paste: async () => {}, scroll: async () => {}, back: async () => {}, beforeSend: async () => {},
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
  it("no pulsa el campo de comentario si SIGUIENTE lo tapa y no existe otro acceso", async () => {
    const covered = screen([{ desc: "Añadir un comentario", y: 798 }, { desc: "SIGUIENTE:", y: 807 }]);
    const { deps: d, taps } = deps([screen([]), covered, covered, covered, covered, covered]);
    d.scroll = async () => { throw new Error("No debe cambiar de reel"); };
    await expect(inspectCommentThreadNavigation({ ...message, postUrl: "https://www.facebook.com/reel/123" }, d)).rejects.toThrow("No se ha localizado");
    expect(taps).toEqual([]);
  });
  it("prefiere Comentar marcado no clickable al campo tapado por SIGUIENTE", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([
        { desc: "Comentar", cls: "android.widget.Button", clickable: false, y: 446 },
        { desc: "Añadir un comentario", cls: "android.widget.Button", clickable: true, y: 798 },
        { desc: "SIGUIENTE:", y: 807 }
      ]), screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 705 }])
    ]);
    expect(await inspectCommentThreadNavigation({ ...message, postUrl: "https://www.facebook.com/reel/123" }, d)).toContain("Campo de comentario localizado");
    expect(taps).toEqual([486]);
  });
  it("espera los controles de un reel sin desplazarlo hacia otro vídeo", async () => {
    const { deps: d } = deps([screen([]), screen([{ text: "Vídeo", y: 200 }]), screen([{ desc: "1 comentario", y: 450 }]), screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 705 }])]);
    d.scroll = async () => { throw new Error("No debe cambiar de reel"); };
    expect(await inspectCommentThreadNavigation({ ...message, postUrl: "https://www.facebook.com/reel/123" }, d)).toContain("Campo de comentario localizado");
  });
  it("no busca publicaciones anteriores desplazando el vídeo cuando el panel no se abrió", async () => {
    const reel = screen([{ desc: "1 comentario", y: 450 }]);
    const { deps: d } = deps([reel, reel, reel]);
    d.scroll = async () => { throw new Error("No debe cambiar de reel"); };
    d.paste = async () => { throw new Error("No debe escribir"); };
    await expect(postCommentThreadMessage({ ...message, postUrl: "https://www.facebook.com/reel/123" }, d)).rejects.toThrow("panel de comentarios del reel no está abierto");
  });
  it("prefiere el contador al campo inferior que puede estar tapado por el siguiente reel", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([
        { desc: "Añadir un comentario", cls: "android.widget.Button", y: 798 },
        { desc: "1 comentario", cls: "android.widget.Button", y: 461 },
        { desc: "SIGUIENTE:", y: 807 }
      ]), screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 705 }])
    ]);
    expect(await inspectCommentThreadNavigation(message, d)).toContain("Campo de comentario localizado");
    expect(taps).toEqual([501]);
  });
  it("abre el contador del reel sin exigir una descripción encima ni tocar Compartir", async () => {
    const reel = screen([
      { desc: "3 reacciones", y: 368 },
      { desc: "1 comentario", cls: "android.widget.Button", y: 461 },
      { desc: "Compartir, 15 veces compartido", y: 554 },
      { desc: "Guardar", y: 647 },
      { desc: "Aquaking, configuración de privacidad Público", y: 713 }
    ]);
    const { deps: d, taps } = deps([screen([]), reel, expandedReply]);
    d.scroll = async () => { throw new Error("No debe desplazar el reel para buscar comentarios"); };
    expect(await inspectCommentThreadNavigation({ ...message, mode: "reply", replyToText: parentText }, d)).toContain(parentText);
    expect(taps).toEqual([501]);
  });

  it.each(["Añadir un comentario", "Añade un comentario…", "Add a comment"])("reconoce el acceso del reel %s", async (label) => {
    const { deps: d, taps } = deps([
      screen([]), screen([{ desc: label, cls: "android.widget.Button", y: 798 }]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 705 }])
    ]);
    d.scroll = async () => { throw new Error("No debe desplazar el reel"); };
    expect(await inspectCommentThreadNavigation(message, d)).toContain("Campo de comentario localizado");
    expect(taps).toEqual([838]);
  });

  it("no confunde dos desplazamientos sin efecto con el final del hilo", async () => {
    const stalled = expandedReply.replaceAll(parentText, "Otro comentario");
    const { deps: d } = deps([screen([]), stalled, stalled, stalled, expandedReply]);
    let scrolls = 0;
    d.scroll = async () => { scrolls++; };
    expect(await inspectCommentThreadNavigation({ ...message, mode: "reply", replyToText: parentText }, d)).toContain(parentText);
    expect(scrolls).toBe(3);
  });
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
  it("cierra el teclado del reel y verifica de nuevo antes del checkpoint y envío", async () => {
    const editor = screen([{ text: message.text, cls: "android.widget.EditText", y: 436 }]).replace('focused="false"', 'focused="true"');
    const { deps: d } = deps([
      screen([]), screen([]), screen([]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 705 }]),
      editor,
      screen([{ text: message.text, cls: "android.widget.EditText", y: 705 }, { desc: "Enviar", y: 822 }]),
      screen([{ text: message.text, y: 300 }])
    ]);
    const actions: string[] = [];
    d.back = async () => { actions.push("back"); };
    d.beforeSend = async () => { actions.push("checkpoint"); };
    d.tap = async (point) => { actions.push(`tap:${point.y}`); };
    expect((await postCommentThreadMessage(message, d)).outcome).toBe("sent");
    expect(actions).toEqual(["tap:745", "back", "checkpoint", "tap:862"]);
  });

  it.each(["texto cambiado", "editor ausente", "envío ausente"])("no envía si tras cerrar el teclado queda %s", async (failure) => {
    const editor = screen([{ text: message.text, cls: "android.widget.EditText", y: 436 }]).replace('focused="false"', 'focused="true"');
    const after = screen([
      ...(failure === "editor ausente" ? [] : [{ text: failure === "texto cambiado" ? "Otro texto" : message.text, cls: "android.widget.EditText", y: 705 }]),
      ...(failure === "envío ausente" ? [] : [{ desc: "Enviar", y: 822 }])
    ]);
    const { deps: d, taps } = deps([screen([]), screen([]), screen([]), editor, editor, after]);
    let backs = 0;
    let checkpoints = 0;
    d.back = async () => { backs++; };
    d.beforeSend = async () => { checkpoints++; };
    await expect(postCommentThreadMessage(message, d)).rejects.toThrow("No se ha podido verificar");
    expect(backs).toBe(1);
    expect(checkpoints).toBe(0);
    expect(taps).toEqual([476]);
  });

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
  it("verifica un envío oculto por el filtro de Facebook sin volver a escribir", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([{ text: "Comentar", y: 100 }]),
      screen([{ text: "Más pertinentes", y: 200 }]),
      screen([{ text: "Todos los comentarios", y: 300 }]),
      screen([{ text: "Ver 5 respuestas", y: 400 }]),
      screen([{ text: message.text, y: 500 }])
    ]);
    d.paste = async () => { throw new Error("No debe volver a escribir"); };
    d.beforeSend = async () => { throw new Error("No debe volver a enviar"); };
    expect((await postCommentThreadMessage({ ...message, sendProtocol: "checkpoint-v1", outcome: "review" }, d)).outcome).toBe("sent");
    expect(taps).toEqual([140, 240, 340, 440]);
  });
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

describe("obstáculos en móviles lentos", () => {
  const photoSheet = screen([{ text: "Guardar en el teléfono", y: 500 }, { text: "Compartir externamente", y: 600 }, { text: "Denunciar foto", y: 700 }]);
  it("cierra el menú de la foto (pulsación larga) y sigue publicando", async () => {
    const { deps: d, taps } = deps([
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Inicio", y: 100 }]),
      screen([{ text: "Inicio", y: 100 }]),
      photoSheet,
      screen([{ desc: "Comentar, botón", y: 1500 }]),
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 2000 }, { desc: "Enviar", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.TextView", y: 900 }])
    ]);
    let backs = 0;
    d.back = async () => { backs += 1; };
    expect((await postCommentThreadMessage(message, d)).outcome).toBe("sent");
    expect(backs).toBe(1);
    expect(taps).toEqual([1540, 2040, 2040]);
  });
  it("si no hay «Todos los comentarios» cierra el menú y busca con el orden actual", async () => {
    const { deps: d, taps } = deps([
      screen([]), screen([]), screen([]),
      screen([{ text: "Más pertinentes", y: 100 }]),
      screen([{ text: "Opción rara", y: 200 }]),
      expandedReply,
      screen([{ text: "Ana", cls: "android.widget.EditText", y: 700 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 700 }, { text: "Enviar", y: 900 }]),
      screen([{ text: message.text, y: 500 }])
    ]);
    let backs = 0;
    d.back = async () => { backs += 1; };
    expect((await postCommentThreadMessage({ ...message, mode: "reply", replyToText: parentText }, d)).outcome).toBe("sent");
    expect(backs).toBe(1);
    expect(taps[0]).toBe(140);
  });
});

describe("localizar el comentario original", () => {
  it("encuentra el texto y usa el Responder más cercano aunque la estructura no encaje", async () => {
    const { replyButtonBelowText } = await import("../comment-thread-runner");
    const xml = `<hierarchy>
<node package="com.facebook.katana" class="android.view.ViewGroup" text="Azu López" content-desc="" clickable="false" bounds="[90,100][400,140]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="${parentText}" content-desc="" clickable="false" bounds="[90,150][900,260]" />
<node package="com.facebook.katana" class="android.widget.Button" text="" content-desc="Responder al comentario de Azu, botón. Toca dos veces para responder al comentario." clickable="true" bounds="[90,270][200,310]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="Otro comentario cualquiera de otra persona" content-desc="" clickable="false" bounds="[90,400][900,460]" />
<node package="com.facebook.katana" class="android.widget.Button" text="" content-desc="Responder al comentario de Lorenzo, botón." clickable="true" bounds="[90,470][200,510]" />
</hierarchy>`;
    const { normalizeFacebookText } = await import("@/lib/mobile/facebook-conversations");
    expect(replyButtonBelowText(xml, normalizeFacebookText(parentText))?.point.y).toBe(290);
  });
});

describe("visor de foto sin etiquetas", () => {
  const caption = "💧👑 ¡TU AGUA, DIRECTAMENTE EN CASA! 👑💧 ¿Te imaginas tener siempre agua mineral natural en casa?";
  const viewer = (bar: string) => `<hierarchy>
<node package="com.facebook.katana" class="android.widget.Button" text="" content-desc="Atrás" clickable="true" bounds="[0,40][80,120]" />
<node package="com.facebook.katana" class="android.view.View" text="Foto" content-desc="" clickable="false" bounds="[0,130][480,600]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Aquaking" content-desc="" clickable="true" bounds="[20,640][200,670]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="${caption}" content-desc="" clickable="true" bounds="[20,680][460,760]" />
${bar}
<node package="com.facebook.katana" class="android.view.View" text="" content-desc="" clickable="false" bounds="[0,0][480,900]" />
</hierarchy>`;
  it("pulsa el segundo icono de la barra sin etiquetas", async () => {
    const { photoViewerCommentPoint } = await import("../comment-thread-runner");
    const bar = [20, 170, 320].map((x) => `<node package="com.facebook.katana" class="android.view.ViewGroup" text="" content-desc="" clickable="true" bounds="[${x},780][${x + 120},830]" />`).join("");
    expect(photoViewerCommentPoint(viewer(bar))).toEqual({ x: 230, y: 805 });
  });
  it("sin barra detectable, toca justo debajo del texto", async () => {
    const { photoViewerCommentPoint } = await import("../comment-thread-runner");
    const point = photoViewerCommentPoint(viewer(""));
    expect(point!.y).toBeGreaterThan(760);
    expect(point!.y).toBeLessThan(900);
  });
  it("no se activa fuera del visor de foto", async () => {
    const { photoViewerCommentPoint } = await import("../comment-thread-runner");
    expect(photoViewerCommentPoint(viewer("").replace('text="Foto"', 'text="Vídeo"'))).toBeNull();
  });
});

describe("diagnóstico de fallos", () => {
  it("adjunta el recorrido y la última pantalla al error", async () => {
    const { threadRunnerDiagnostics } = await import("../comment-thread-runner");
    const { deps: d } = deps([screen([{ text: "Inicio", y: 100 }])]);
    let caught: unknown;
    try { await postCommentThreadMessage(message, d); } catch (error) { caught = error; }
    const diagnostics = threadRunnerDiagnostics(caught);
    expect(diagnostics?.trace.some((line) => line.includes("Abrir"))).toBe(true);
    expect(diagnostics?.trace.at(-1)).toContain("Error:");
    expect(diagnostics?.xml).toContain("hierarchy");
  });
});
