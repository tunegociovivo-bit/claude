import type { NativeComment } from "@/components/mobile/facebook-conversation-ui";
import { describe, expect, it, vi } from "vitest";
import { scanFacebookConversations, sendFacebookConversationReplies, type ConversationRunnerDependencies } from "@/components/mobile/facebook-conversation-runner";
import { createConversationBatch, type ConversationReply } from "@/lib/mobile/facebook-conversations";

const commentScreen = `<hierarchy>
<node package="com.facebook.katana" class="android.widget.ImageView" content-desc="Foto de perfil de Ana" bounds="[33,843][143,953]" />
<node package="com.facebook.katana" class="android.widget.Button" text="Ana" bounds="[154,838][394,899]" />
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
