import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardResendReceivedEmail } from "../email";

const ORIGINAL_ENV = { ...process.env };

function inboundMessage() {
  return [
    "From: Cliente <cliente@example.com>",
    "To: info@ia.negociovivo.app",
    "Subject: Respuesta a la auditoria",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="nv-boundary"',
    "",
    "--nv-boundary",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    "Quiero recibir mas informacion.",
    "--nv-boundary",
    'Content-Type: text/plain; name="datos.txt"',
    "Content-Disposition: attachment; filename=datos.txt",
    "Content-Transfer-Encoding: base64",
    "",
    "SG9sYQ==",
    "--nv-boundary--",
    ""
  ].join("\r\n");
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("forwardResendReceivedEmail", () => {
  it("reenvia el cuerpo y los adjuntos del email recibido", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/emails/receiving/inbound-1")) {
        return new Response(JSON.stringify({ raw: { download_url: "https://download.resend.test/raw-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "https://download.resend.test/raw-1") {
        return new Response(inboundMessage(), { status: 200 });
      }
      if (url.endsWith("/emails")) {
        return new Response(JSON.stringify({ id: "forwarded-1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    }));

    const result = await forwardResendReceivedEmail({
      emailId: "inbound-1",
      from: "Negocio Vivo <info@ia.negociovivo.app>",
      to: "info@negociovivo.com",
      idempotencyKey: "resend-received:event-1",
      globalConfigOnly: true
    });

    expect(result).toEqual({ id: "forwarded-1" });
    const sendRequest = requests.find((request) => request.url.endsWith("/emails"));
    expect(sendRequest).toBeDefined();
    expect(sendRequest?.init?.headers).toMatchObject({ "Idempotency-Key": "resend-received:event-1" });
    const body = JSON.parse(String(sendRequest?.init?.body));
    expect(body).toMatchObject({
      from: "Negocio Vivo <info@ia.negociovivo.app>",
      to: ["info@negociovivo.com"],
      subject: "Respuesta a la auditoria",
      text: expect.stringContaining("Quiero recibir mas informacion.")
    });
    expect(body.attachments).toEqual([
      expect.objectContaining({
        filename: "datos.txt",
        content: "SG9sYQ==",
        content_type: "text/plain"
      })
    ]);
  });

  it("falla sin enviar si Resend no ofrece el mensaje original", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ raw: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(forwardResendReceivedEmail({
      emailId: "inbound-without-raw",
      from: "Negocio Vivo <info@ia.negociovivo.app>",
      to: "info@negociovivo.com",
      globalConfigOnly: true
    })).rejects.toThrow("contenido original");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
