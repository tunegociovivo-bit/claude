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
