import { z } from "zod";

const label = z.string().trim().max(40).optional();

export const provisionVapiPhoneSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("PURCHASED"),
    areaCode: z.string().trim().regex(/^\d{3}$/, "Introduce un prefijo de EE. UU. de 3 dígitos"),
    label,
  }),
  z.object({
    mode: z.literal("IMPORTED"),
    providerKind: z.literal("twilio"),
    phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Usa formato internacional, por ejemplo +34911222333"),
    twilioAccountSid: z.string().trim().min(10).max(80),
    twilioAuthToken: z.string().min(10).max(200),
    label,
  }),
]);

export type ProvisionVapiPhoneInput = z.infer<typeof provisionVapiPhoneSchema>;

const e164 = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Usa formato internacional, por ejemplo +34611222333");

// Flujo comercial: el cliente solo indica su móvil público. Sin credenciales.
export const businessPhoneSchema = z.object({
  phoneNumber: e164,
  label,
});
export type BusinessPhoneInput = z.infer<typeof businessPhoneSchema>;

// Flujo interno de Negocio Vivo: registrar una infraestructura ya creada
// (número puente Twilio + recurso en Vapi) para un workspace concreto.
export const operatorRegisterPhoneSchema = z.object({
  workspaceId: z.string().trim().min(1),
  vapiPhoneNumberId: z.string().trim().min(8).max(80),
  bridgeE164: e164,
  publicE164: e164.optional(),
  label,
  // true = además de registrar, apuntar el inbound del número al webhook del
  // workspace (misma operación que usa el autoservicio).
  configureInbound: z.boolean().optional(),
  // true = marcar la conexión como ACTIVA (desvío configurado y probado).
  activate: z.boolean().optional(),
});
export type OperatorRegisterPhoneInput = z.infer<typeof operatorRegisterPhoneSchema>;
