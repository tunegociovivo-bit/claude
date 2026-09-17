import type { NativeComment } from "@/components/mobile/facebook-conversation-ui";
import { describe, expect, it, vi } from "vitest";
import { openJoinedList, scanFacebookConversations, sendFacebookConversationReplies, type ConversationRunnerDependencies } from "@/components/mobile/facebook-conversation-runner";
import { createConversationBatch, type ConversationReply } from "@/lib/mobile/facebook-conversations";

const commentScreen = `<hierarchy>
<node package="com.facebook.katana" class="android.widget.ImageView" content-desc="Foto de perfil de Ana" bounds="[33,843][143,953]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Ana" bounds="[154,838][394,899]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="1 d" bounds="[400,840][450,880]" />
<node package="com.facebook.katana" class="android.view.ViewGroup" text="¿Qué supermercado recomiendas?" bounds="[165,920][900,1030]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Responder al comentario de Ana, botón. Toca dos veces para responder al comentario." bounds="[143,1050][349,1133]" />
</hierarchy>`;
const composer = '<node package="com.facebook.katana" class="android.widget.EditText" text="Escribe una respuesta" bounds="[100,1900][900,2000]" />';
const filled = '<node package="com.facebook.katana" class="android.widget.EditText" text="Mi opinión" bounds="[100,1900][900,2000]" /><node package="com.facebook.katana" class="android.widget.Button" text="Enviar" bounds="[900,1900][1000,2000]" />';
const config = { targetUrl: "https://www.facebook.com/groups/test/posts/123/", niche: "", criteria: "", replyGuidance: "Mi opinión", postsPerGroup: 1, commentScreensPerPost: 1 };
const item: ConversationReply = { id: "1", groupName: "Franquicias", groupUrl: config.targetUrl, postAnchor: config.targetUrl, author: "Ana", sourceText: "¿Qué supermercado recomiendas?", sourceLabel: "Responder al comentario de Ana", reply: "Mi opinión", selected: true, outcome: "pending", detail: "", reason: "Relevante" };
const setup = (): ConversationRunnerDependencies => ({
  read: vi.fn(async () => commentScreen), tap: vi.fn(async () => {}), scroll: vi.fn(async () => {}), back: vi.fn(async () => {}), openUrl: vi.fn(async () => {}), paste: vi.fn(async () => {}), wait: vi.fn(async () => {}), checkpoint: vi.fn(async () => {}), filterGroups: vi.fn(async (names) => names), analyze: vi.fn(async (comments: NativeComment[]) => comments.map((comment) => ({ id: comment.id, reply: "Mi opinión", reason: "Relevante" })))
});
describe("Facebook conversation execution", () => {
  it.each(["40 d", ""])("does not send old or undated comments to AI: %s", async (label) => {
    const deps = setup();
    vi.mocked(deps.read).mockResolvedValue(commentScreen.replace('text="1 d"', `text="${label}"`));
    const result = await scanFacebookConversations(createConversationBatch(config), deps);
    expect(result.candidates).toEqual([]);
    expect(deps.analyze).not.toHaveBeenCalled();
    if (!label) expect(result.warnings).toHaveLength(1);
  });
  it.each(["0 comentarios", "Comentar"])("skips posts without a positive counter: %s", async (label) => {
    const deps = setup();
    vi.mocked(deps.read).mockResolvedValue(`<node package="com.facebook.katana" class="android.view.ViewGroup" text="Una publicación sobre supermercados" bounds="[100,300][900,500]" /><node package="com.facebook.katana" class="android.widget.Button" text="${label}" bounds="[100,600][500,700]" />`);
    await scanFacebookConversations(createConversationBatch(config), deps);
    expect(deps.tap).not.toHaveBeenCalled();
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("collects drafts without pressing reply or sending", async () => {
    const deps = setup();
    const result = await scanFacebookConversations(createConversationBatch(config), deps);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ sourceText: item.sourceText, reply: "Mi opinión", outcome: "pending" });
    expect(deps.paste).not.toHaveBeenCalled();
  });
  it("never repeats an uncertain or already confirmed send", async () => {
    const deps = setup();
    await sendFacebookConversationReplies({ ...createConversationBatch(config), candidates: [{ ...item, outcome: "sending" }, { ...item, id: "2", outcome: "sent" }, { ...item, id: "3", selected: false }] }, deps);
    expect(deps.tap).not.toHaveBeenCalled();
    expect(deps.openUrl).not.toHaveBeenCalled();
  });
  it("opens the second comment control when Facebook first opens a reel", async () => {
    const deps = setup();
    const feed = '<node package="com.facebook.katana" class="android.view.ViewGroup" text="Una publicación sobre supermercados" bounds="[100,300][900,500]" /><node package="com.facebook.katana" class="android.widget.Button" text="5 comentarios" bounds="[100,600][500,700]" />';
    const reel = '<node package="com.facebook.katana" class="android.widget.Button" content-desc="5 comentarios" bounds="[900,1400][1080,1500]" />';
    vi.mocked(deps.read).mockResolvedValueOnce(feed).mockResolvedValueOnce(reel).mockResolvedValueOnce(reel).mockResolvedValue(commentScreen);
    const result = await scanFacebookConversations(createConversationBatch(config), deps);
    expect(deps.tap).toHaveBeenCalledWith({ x: 990, y: 1450 });
    expect(result.candidates).toHaveLength(1);
    expect(deps.back).toHaveBeenCalledTimes(2);
  });
  it("keeps comments from same-name groups distinct and avoids re-analyzing saved comments", async () => {
    const deps = setup();
    const initial = createConversationBatch(config);
    initial.groups = [{ name: "Franquicias", details: "100 miembros", status: "pending", detail: "" }, { name: "Franquicias", details: "200 miembros", status: "pending", detail: "" }];
    const first = await scanFacebookConversations(initial, deps);
    expect(first.candidates).toHaveLength(2);
    expect(new Set(first.candidates.map((candidate) => candidate.id)).size).toBe(2);
    first.groups.forEach((group) => { group.status = "pending"; });
    vi.mocked(deps.analyze).mockClear();
    const resumed = await scanFacebookConversations(first, deps);
    expect(resumed.candidates).toHaveLength(2);
    expect(deps.analyze).not.toHaveBeenCalled();
  });
  it("does not leave the group when a normal post exposes a horizontal comment counter", async () => {
    const deps = setup();
    const feed = '<node package="com.facebook.katana" class="android.view.ViewGroup" text="Una publicación sobre supermercados" bounds="[100,300][900,500]" /><node package="com.facebook.katana" class="android.widget.Button" text="5 comentarios" bounds="[100,600][500,700]" />';
    const post = '<node package="com.facebook.katana" class="android.widget.Button" content-desc="5 comentarios" bounds="[100,1400][1080,1500]" />';
    vi.mocked(deps.read).mockResolvedValueOnce(feed).mockResolvedValueOnce(post).mockResolvedValueOnce(post).mockResolvedValue(commentScreen);
    await scanFacebookConversations(createConversationBatch(config), deps);
    expect(deps.tap).toHaveBeenCalledTimes(1);
    expect(deps.back).toHaveBeenCalledTimes(1);
  });
  it("does not send when the original author or comment changed", async () => {
    const deps = setup();
    const result = await sendFacebookConversationReplies({ ...createConversationBatch(config), candidates: [{ ...item, author: "Otro autor" }] }, deps);
    expect(result.candidates[0].outcome).toBe("failed");
    expect(deps.paste).not.toHaveBeenCalled();
  });
  it("records send intent before tapping and only reports visible confirmation", async () => {
    const deps = setup();
    vi.mocked(deps.read).mockResolvedValueOnce(commentScreen).mockResolvedValueOnce(composer).mockResolvedValueOnce(filled).mockResolvedValueOnce('<node package="com.facebook.katana" class="android.view.ViewGroup" text="Mi opinión" bounds="[100,900][900,1000]" />');
    const checkpoints: string[] = [];
    vi.mocked(deps.checkpoint).mockImplementation(async (batch) => { checkpoints.push(batch.candidates[0].outcome); });
    const result = await sendFacebookConversationReplies({ ...createConversationBatch(config), candidates: [item] }, deps);
    expect(checkpoints).toEqual(["pending", "sending", "sent"]);
    expect(result.candidates[0].outcome).toBe("sent");
    expect(deps.paste).toHaveBeenCalledExactlyOnceWith("Mi opinión");
  });
  it("keeps an unconfirmed send for manual review", async () => {
    const deps = setup();
    vi.mocked(deps.read).mockResolvedValueOnce(commentScreen).mockResolvedValueOnce(composer).mockResolvedValueOnce(filled).mockResolvedValueOnce("<hierarchy />");
    const result = await sendFacebookConversationReplies({ ...createConversationBatch(config), candidates: [item] }, deps);
    expect(result.candidates[0].outcome).toBe("review");
  });
});


describe("regresiones de búsqueda y fechas", () => {
  it("aplica el intervalo personalizado antes de generar respuestas", async () => {
    for (const [label, count] of [["10 de septiembre de 2026", 1], ["10 de agosto de 2026", 0]] as const) {
      const deps = setup();
      vi.mocked(deps.read).mockResolvedValue(commentScreen.replace('text="1 d"', 'text="' + label + '"'));
      const result = await scanFacebookConversations(createConversationBatch({ ...config, dateFrom: "2026-09-01", dateTo: "2026-09-16", referenceTime: "2026-09-16T12:00:00Z" }), deps);
      expect(result.candidates).toHaveLength(count);
      if (!count) expect(deps.analyze).not.toHaveBeenCalled();
    }
  });
  it("no pulsa Atrás cuando Facebook no abrió un hilo de comentarios", async () => {
    const deps = setup();
    const feed = '<node package="com.facebook.katana" class="android.view.ViewGroup" text="Una publicación sobre supermercados" bounds="[100,300][900,500]" /><node package="com.facebook.katana" class="android.widget.Button" text="5 comentarios" bounds="[100,600][500,700]" />';
    vi.mocked(deps.read).mockResolvedValue(feed);
    const result = await scanFacebookConversations(createConversationBatch(config), deps);
    expect(deps.back).not.toHaveBeenCalled();
    expect(result.groups[0].status).toBe("failed");
    expect(result.progress).toContain("incompleta");
  });
  it("omite publicaciones ajenas a la palabra clave antes de abrirlas", async () => {
    const deps = setup();
    vi.mocked(deps.read).mockResolvedValue('<node package="com.facebook.katana" class="android.view.ViewGroup" text="Viajes y turismo en el Caribe" bounds="[100,300][900,500]" /><node package="com.facebook.katana" class="android.widget.Button" text="5 comentarios" bounds="[100,600][500,700]" />');
    await scanFacebookConversations(createConversationBatch({ ...config, searchMode: "posts", searchTerm: "franquicias" }), deps);
    expect(deps.tap).not.toHaveBeenCalled();
    expect(deps.analyze).not.toHaveBeenCalled();
  });
});

describe("joined group navigation recovery", () => {
  const node = (text: string, pkg = "com.facebook.katana") => '<node package="' + pkg + '" class="android.widget.Button" text="' + text + '" bounds="[100,300][600,400]" />';
  it("returns to Facebook from the Xiaomi launcher and uses the menu without Back", async () => {
    const deps = setup(); deps.relaunch = vi.fn(async () => {});
    vi.mocked(deps.read).mockResolvedValueOnce(node("Pregunta a la IA", "com.mi.globalminusscreen"))
      .mockResolvedValueOnce(node("Pregunta a la IA", "com.mi.globalminusscreen"))
      .mockResolvedValueOnce(node("Menú, pestaña 6 de 6"))
      .mockResolvedValueOnce(node("Grupos"))
      .mockResolvedValueOnce(node("Tus grupos"))
      .mockResolvedValue(node("Buscar tus grupos por nombre"));
    expect(await openJoinedList(deps)).toContain("Buscar tus grupos por nombre");
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
    expect(deps.tap).toHaveBeenCalledTimes(3);
    expect(deps.back).not.toHaveBeenCalled();
  });
  it("stops with a navigation error instead of backing out of Facebook repeatedly", async () => {
    const deps = setup(); vi.mocked(deps.read).mockResolvedValue(node("Cargando"));
    await expect(openJoinedList(deps)).rejects.toThrow("búsqueda está pausada");
    expect(deps.back).not.toHaveBeenCalled();
    expect(deps.read).toHaveBeenCalledTimes(17);
  });
});
