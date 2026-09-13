import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { normalizeEmail, emailCandidateScore, emailMatchesWebsiteDomain, hunterStatusToVerification, isAllowedWebsiteContactEmail, isEligibleOutreachEmail } from "../email-verification";
import { isPrivateIp } from "../email-extract";
import { classifyResendFailure, isAutomaticEmailReply, resendFailureRetryAt, verifyResendWebhook } from "../resend-webhook";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribe-token";
import { buildGmbCadencePlan } from "../gmb-cadence-plan";
import { isPermanentNoContactReply } from "../reply-classification";

describe("NV Leads Pro multichannel email", () => {
  const previousSecret = process.env.LEADS_UNSUBSCRIBE_SECRET;
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.LEADS_UNSUBSCRIBE_SECRET;
    else process.env.LEADS_UNSUBSCRIBE_SECRET = previousSecret;
  });

  it("normalizes valid email and rejects malformed values", () => {
    expect(normalizeEmail(" MailTo:Info@Example.COM ")).toBe("info@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("prioritizes a role address on the business domain", () => {
    expect(emailCandidateScore("info@negocio.es", "https://www.negocio.es/contacto"))
      .toBeGreaterThan(emailCandidateScore("persona@gmail.com", "https://negocio.es"));
  });

  it("uses the exact requested offsets for both branches", () => {
    const anchor = new Date("2026-09-13T09:00:00.000Z");
    expect(buildGmbCadencePlan(true, anchor).map((item) => [item.stage, item.offsetHours])).toEqual([
      ["mobile_day1", 0], ["mobile_day3", 72], ["mobile_day8_whatsapp", 168], ["mobile_day8_email", 168]
    ]);
    expect(buildGmbCadencePlan(false, anchor).map((item) => [item.stage, item.offsetHours])).toEqual([
      ["email_day1", 0], ["email_day3", 48]
    ]);
  });

  it("blocks privacy/system mailboxes and intermediary booking domains", () => {
    expect(isEligibleOutreachEmail("info@negocio.es")).toBe(true);
    expect(isEligibleOutreachEmail("privacy-es@negocio.es")).toBe(false);
    expect(isEligibleOutreachEmail("dpo.spain@negocio.es")).toBe(false);
    expect(isEligibleOutreachEmail("lopd+web@negocio.es")).toBe(false);
    expect(emailMatchesWebsiteDomain("info@negocio.es", "https://negocio.es/contacto")).toBe(true);
    expect(emailMatchesWebsiteDomain("soporte@booksy.com", "https://booksy.com/es-es/negocio")).toBe(false);
  });

  it("accepts evidenced webmail but rejects an external web-designer footer", () => {
    expect(isAllowedWebsiteContactEmail("empresa@gmail.com", "https://negocio.es", { method: "mailto", pageKind: "home" })).toBe(true);
    expect(isAllowedWebsiteContactEmail("empresa@hotmail.com", "https://negocio.es", { method: "text", pageKind: "contact" })).toBe(true);
    expect(isAllowedWebsiteContactEmail("empresa@gmail.com", "https://negocio.es", { method: "text", pageKind: "home" })).toBe(false);
    expect(isAllowedWebsiteContactEmail("info@agencia-web.es", "https://negocio.es", { method: "mailto", pageKind: "contact" })).toBe(false);
    expect(isAllowedWebsiteContactEmail("reservas@booksy.com", "https://negocio.es", { method: "mailto", pageKind: "contact" })).toBe(false);
  });

  it("only treats a mailbox-level valid verdict as autonomously deliverable", () => {
    expect(hunterStatusToVerification("valid", 100)).toBe("deliverable");
    expect(hunterStatusToVerification("accept_all", 99)).toBe("risky");
    expect(hunterStatusToVerification("invalid", 0)).toBe("invalid");
  });

  it("blocks private IPv4, hexadecimal mapped IPv6 and embedded transition ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIp("[::ffff:127.0.0.1]")).toBe(true);
    expect(isPrivateIp("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateIp("2002:7f00:0001::")).toBe(true);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it("verifies signed Resend events and rejects tampering", () => {
    const key = Buffer.from("test-webhook-key");
    const secret = `whsec_${key.toString("base64")}`;
    const id = "evt_123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ type: "email.opened" });
    const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
    expect(verifyResendWebhook({ rawBody, id, timestamp, signature: `v1,${signature}`, secret })).toBe(true);
    expect(verifyResendWebhook({ rawBody: `${rawBody}x`, id, timestamp, signature: `v1,${signature}`, secret })).toBe(false);
  });

  it("recognizes RFC auto-replied messages without treating them as a human reply", () => {
    expect(isAutomaticEmailReply({
      subject: "Re: Datos sobre tu posicionamiento",
      text: "Gracias por su mensaje",
      headers: { "Auto-Submitted": "auto-replied" }
    })).toBe(true);
    expect(isAutomaticEmailReply({
      subject: "Re: Datos sobre tu posicionamiento",
      text: "Sí, me interesa la auditoría",
      headers: { "Auto-Submitted": "no" }
    })).toBe(false);
    expect(isAutomaticEmailReply({
      subject: "Re: Datos",
      text: "Gracias por escribir",
      headers: [{ name: "Auto-Submitted", value: "auto-generated" }]
    })).toBe(true);
  });

  it("makes minimal unsubscribe and no-interest replies permanent", () => {
    expect(isPermanentNoContactReply("BAJA")).toBe(true);
    expect(isPermanentNoContactReply("STOP")).toBe(true);
    expect(isPermanentNoContactReply("Gracias, pero no nos interesa")).toBe(true);
    expect(isPermanentNoContactReply("No necesito vuestro servicio")).toBe(true);
    expect(isPermanentNoContactReply("No queremos vuestra oferta")).toBe(true);
    expect(isPermanentNoContactReply("Ahora no, llámame mañana")).toBe(false);
    expect(isPermanentNoContactReply("No quiero perder esta oportunidad, llamadme hoy")).toBe(false);
    expect(isPermanentNoContactReply("No quiero esperar, enviadme la auditoría ya")).toBe(false);
    expect(isPermanentNoContactReply("Gracias pero no entiendo la propuesta, ¿me podéis llamar?")).toBe(false);
    expect(isPermanentNoContactReply("Gracias pero no veo el informe, reenviádmelo")).toBe(false);
  });

  it("classifies Resend failures into permanent, quota and configuration actions", () => {
    expect(classifyResendFailure("invalid_recipient: The recipient email is invalid")).toBe("invalid_recipient");
    expect(classifyResendFailure("reached_daily_quota")).toBe("quota");
    expect(classifyResendFailure("Domain is not verified", 403)).toBe("configuration");
    expect(classifyResendFailure("upstream timeout", 500)).toBe("transient");
    const now = new Date("2026-09-13T12:00:00.000Z");
    expect(resendFailureRetryAt("reached_daily_quota", now).toISOString()).toBe("2026-09-14T00:05:00.000Z");
  });

  it("encrypts unsubscribe links and detects tampering", () => {
    process.env.LEADS_UNSUBSCRIBE_SECRET = "a-long-stable-test-secret";
    const token = createUnsubscribeToken({ workspaceId: "ws_1", leadId: "lead_1", email: "info@example.com" });
    expect(token.split(".")).toHaveLength(4);
    expect(token).not.toContain("info@example.com");
    expect(verifyUnsubscribeToken(token)).toMatchObject({ workspaceId: "ws_1", leadId: "lead_1", email: "info@example.com" });
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });
});
