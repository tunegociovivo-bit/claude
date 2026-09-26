import { describe, expect, it } from "vitest";
import { postCommentThreadMessage } from "../comment-thread-runner";
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
      openUrl: async () => {}, wait: async () => {}, paste: async () => {}, scroll: async () => {},
      tap: async (point: { y: number }) => { taps.push(point.y); },
      read: async () => { const next = screens.shift(); if (next instanceof Error) throw next; return next ?? screen([]); }
    }
  };
}

describe("publicar mensaje de conversación", () => {
  it("toca «Comentar», reintenta lecturas fallidas y publica", async () => {
    const posted = screen([{ text: message.text, cls: "android.widget.TextView", y: 900 }]);
    const { deps: d, taps } = deps([
      new Error("uiautomator ocupado"),
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
      screen([{ text: "Escribe un comentario…", cls: "android.widget.EditText", y: 2000 }]),
      screen([{ text: message.text, cls: "android.widget.EditText", y: 2000 }, { text: "Publicar", y: 2000 }]),
      new Error("x"), new Error("x"), new Error("x")
    ]);
    const result = await postCommentThreadMessage(message, d);
    expect(result.outcome).toBe("review");
  });
});
