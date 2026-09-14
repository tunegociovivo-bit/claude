import { createHash, createHmac, randomBytes } from "crypto";
import { z } from "zod";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
  deviceId: z.string().trim().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/),
});

export function normalizeEnrollmentRequest(input: unknown) {
  return requestSchema.parse(input);
}

export function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createEnrollmentRequestKey(email: string, now = new Date()) {
  const dayBucket = now.toISOString().slice(0, 10);
  return hashEnrollmentToken(`${email.trim().toLowerCase()}:${dayBucket}`);
}

export function createEnrollmentApiCredential(input: { requestId: string; code: string; deviceId: string; serverSecret: string }) {
  const material = `${input.requestId}:${normalizeEnrollmentCode(input.code)}:${input.deviceId}`;
  const digest = createHmac("sha256", input.serverSecret).update(material).digest("base64url");
  return { prefix: `ag_${hashEnrollmentToken(input.requestId).slice(0, 12)}`, secret: digest.slice(0, 32) };
}

export function createEnrollmentCode() {
  const prefix = randomBytes(5).toString("hex").toUpperCase();
  const secret = randomBytes(10).toString("base64url").toUpperCase();
  return { prefix, display: `NV-${prefix}-${secret}` };
}

export function createEmailVerificationCode() {
  const prefix = randomBytes(5).toString("hex").toUpperCase();
  const secret = randomBytes(10).toString("base64url").toUpperCase();
  return { prefix, display: `NVV-${prefix}-${secret}` };
}

export function normalizeEnrollmentCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function enrollmentCodePrefix(value: string) {
  const match = normalizeEnrollmentCode(value).match(/^NV-([A-F0-9]{10})-([A-Z0-9_-]{14})$/);
  return match?.[1] ?? null;
}

export function emailVerificationCodePrefix(value: string) {
  const match = normalizeEnrollmentCode(value).match(/^NVV-([A-F0-9]{10})-([A-Z0-9_-]{14})$/);
  return match?.[1] ?? null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

export function buildAdminEnrollmentEmail(input: { name: string; email: string; approvalUrl: string }) {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const approvalUrl = escapeHtml(input.approvalUrl);
  return {
    subject: `Solicitud de vinculacion · ${input.name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55"><h2>Nuevo equipo pendiente de vincular</h2><p><strong>Nombre:</strong> ${name}<br><strong>Email:</strong> ${email}</p><p>Selecciona en el Hub el trabajador correspondiente. El codigo se enviara automaticamente al correo facilitado.</p><p><a href="${approvalUrl}" style="display:inline-block;background:#4f46e5;color:white;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">Revisar y generar codigo</a></p><p style="font-size:12px;color:#64748b">El enlace caduca en 24 horas y requiere iniciar sesion como administrador.</p></div>`,
  };
}

export function buildEmailVerificationEmail(input: { name: string; code: string }) {
  const name = escapeHtml(input.name);
  const code = escapeHtml(input.code);
  return {
    subject: "Confirma la solicitud de vinculacion · Negocio Vivo",
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55"><h2>Confirma tu equipo</h2><p>Hola ${name},</p><p>Introduce este codigo en el programa Control horario para confirmar que el correo es tuyo:</p><p style="font:700 20px monospace;letter-spacing:1px;background:#eef2ff;padding:14px;border-radius:9px">${code}</p><p>Si el correo coincide con un trabajador activo del Hub, el equipo quedara vinculado automaticamente. El codigo caduca en 24 horas.</p></div>`,
  };
}

export function buildWorkerCodeEmail(input: { name: string; code: string }) {
  const name = escapeHtml(input.name);
  const code = escapeHtml(input.code);
  return {
    subject: "Codigo para vincular tu equipo · Negocio Vivo",
    html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55"><h2>Tu codigo de vinculacion</h2><p>Hola ${name},</p><p>Introduce este codigo en el programa Control horario:</p><p style="font:700 20px monospace;letter-spacing:1px;background:#eef2ff;padding:14px;border-radius:9px">${code}</p><p>El codigo es de un solo uso y caduca en 24 horas.</p></div>`,
  };
}
