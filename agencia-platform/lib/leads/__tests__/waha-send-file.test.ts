import { beforeEach, describe, expect, it, vi } from "vitest";

const { workspaceFind } = vi.hoisted(() => ({ workspaceFind: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspace: { findUnique: workspaceFind } }
}));
vi.mock("@/lib/ai/crypto", () => ({ decryptSecret: (value: string) => value }));

import { sendFile } from "../waha";

describe("WAHA sendFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    workspaceFind.mockReset();
    workspaceFind.mockResolvedValue({
      settings: { leads: { whatsappProvider: "waha", wahaUrl: "https://waha.test", wahaApiKey: "secret" } }
    });
  });

  it("envía el buffer como documento base64 conservando nombre y MIME", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-file-1" }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await sendFile({
      workspaceId: "w1",
      phoneNormalized: "34680167881",
      file: Buffer.from("excel-data"),
      filename: "leads.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      caption: "Aquí tienes el Excel"
    });

    expect(result.messageId).toBe("msg-file-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://waha.test/api/sendFile");
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("secret");
    const body = JSON.parse(String(init?.body));
    expect(body.chatId).toBe("34680167881@c.us");
    expect(body.file.filename).toBe("leads.xlsx");
    expect(body.file.mimetype).toContain("spreadsheetml");
    expect(Buffer.from(body.file.data, "base64").toString()).toBe("excel-data");
    expect(body.caption).toBe("Aquí tienes el Excel");
  });

  it("falla si WAHA responde sin id de mensaje", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    await expect(sendFile({
      workspaceId: "w1",
      phoneNormalized: "34680167881",
      file: Buffer.from("x"),
      filename: "x.pdf",
      mimetype: "application/pdf"
    })).rejects.toThrow("no devolvió ID de mensaje");
  });

  it("enruta documentos al payload nativo de Evolution", async () => {
    workspaceFind.mockResolvedValue({
      settings: {
        leads: {
          whatsappProvider: "evolution",
          evolutionUrl: "https://evolution.test",
          evolutionApiKey: "evo-secret",
          evolutionInstance: "negocio-vivo"
        }
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "evo-file-1" } }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    const result = await sendFile({
      workspaceId: "w1",
      phoneNormalized: "34680167881",
      file: Buffer.from("pdf-data"),
      filename: "informe.pdf",
      mimetype: "application/pdf"
    });
    expect(result.messageId).toBe("evo-file-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://evolution.test/message/sendMedia/negocio-vivo");
    const body = JSON.parse(String(init?.body));
    expect(body.mediatype).toBe("document");
    expect(body.fileName).toBe("informe.pdf");
    expect(body.mimetype).toBe("application/pdf");
  });
});
