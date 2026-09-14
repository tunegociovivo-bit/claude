import { describe, expect, it } from "vitest";
import {
  buildAdminEnrollmentEmail,
  buildEmailVerificationEmail,
  buildWorkerCodeEmail,
  createEnrollmentApiCredential,
  createEnrollmentCode,
  createEnrollmentRequestKey,
  createEmailVerificationCode,
  hashEnrollmentToken,
  normalizeEnrollmentCode,
  normalizeEnrollmentRequest,
} from "../enrollment";

describe("solicitudes de vinculación del control horario", () => {
  it("normaliza nombre, correo y dispositivo sin aceptar datos inválidos", () => {
    expect(normalizeEnrollmentRequest({ name: "  Ana Pérez  ", email: " ANA@EMPRESA.COM ", deviceId: "pc-ana_01" })).toEqual({
      name: "Ana Pérez",
      email: "ana@empresa.com",
      deviceId: "pc-ana_01",
    });
    expect(() => normalizeEnrollmentRequest({ name: "A", email: "incorrecto", deviceId: "x" })).toThrow();
  });

  it("genera códigos legibles con entropía suficiente y permite normalizar su escritura", () => {
    const generated = createEnrollmentCode();
    expect(generated.display).toMatch(/^NV-[A-F0-9]{10}-[A-Z0-9_-]{14}$/);
    expect(generated.prefix).toHaveLength(10);
    expect(normalizeEnrollmentCode(`  ${generated.display.toLowerCase()}  `)).toBe(generated.display);
  });

  it("firma tokens de aprobación sin conservar el secreto en claro", () => {
    const first = hashEnrollmentToken("secreto-1");
    const second = hashEnrollmentToken("secreto-2");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("secreto");
  });

  it("deduplica atómicamente las solicitudes por trabajador y día", () => {
    const now = new Date("2026-09-14T10:04:00.000Z");
    expect(createEnrollmentRequestKey("ANA@EMPRESA.COM", now)).toBe(createEnrollmentRequestKey("ana@empresa.com", new Date("2026-09-14T23:59:59.000Z")));
    expect(createEnrollmentRequestKey("ana@empresa.com", now)).not.toBe(createEnrollmentRequestKey("ana@empresa.com", new Date("2026-09-15T00:00:00.000Z")));
  });

  it("crea un código distinto para verificar primero el correo", () => {
    const generated = createEmailVerificationCode();
    expect(generated.display).toMatch(/^NVV-[A-F0-9]{10}-[A-Z0-9_-]{14}$/);
    expect(buildEmailVerificationEmail({ name: "Ana", code: generated.display }).html).toContain(generated.display);
  });

  it("produce la misma credencial al reintentar el canje desde el mismo equipo", () => {
    const input = { requestId: "req-1", code: "NV-1234567890-ABCDEFGHIJKLMN", deviceId: "pc-ana_01", serverSecret: "test-secret" };
    expect(createEnrollmentApiCredential(input)).toEqual(createEnrollmentApiCredential(input));
    expect(createEnrollmentApiCredential(input)).not.toEqual(createEnrollmentApiCredential({ ...input, deviceId: "otro-equipo" }));
  });

  it("escapa los datos del trabajador en ambos correos", () => {
    const admin = buildAdminEnrollmentEmail({ name: "<b>Ana</b>", email: "ana@example.com", approvalUrl: "https://hub.example/control-horario?token=abc" });
    const worker = buildWorkerCodeEmail({ name: "<b>Ana</b>", code: "NV-1234567890-ABCDEFGHIJKLMN" });
    expect(admin.html).not.toContain("<b>Ana</b>");
    expect(admin.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(admin.html).toContain("Revisar y generar código");
    expect(worker.html).toContain("NV-1234567890-ABCDEFGHIJKLMN");
    expect(worker.html).not.toContain("<b>Ana</b>");
  });
});
