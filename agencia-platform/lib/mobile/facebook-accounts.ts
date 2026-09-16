import { z } from "zod";

export type MobileFacebookAccount = {
  id: string;
  name: string;
  username: string;
  hasPassword: boolean;
  active: boolean;
  savedOnDevice: boolean;
  version: number;
  updatedAt: string;
};

const deviceSerial = z.string().trim().min(1).max(160);
export const mobileFacebookAccountRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), deviceSerial }).strict(),
  z.object({
    action: z.literal("save"), deviceSerial,
    id: z.string().uuid(), mutationId: z.string().uuid(),
    version: z.number().int().min(0),
    name: z.string().trim().min(1, "Indica el nombre que aparece en Facebook.").max(120),
    username: z.string().trim().min(1, "Indica el usuario, correo o teléfono de acceso.").max(254),
    // Do not trim passwords: spaces can be part of a valid credential.
    password: z.string().min(1).max(1024).optional(),
    savedOnDevice: z.boolean()
  }).strict(),
  z.object({
    action: z.literal("setActive"), deviceSerial,
    id: z.string().uuid(), mutationId: z.string().uuid(),
    version: z.number().int().min(1), active: z.boolean()
  }).strict()
]);
export type MobileFacebookAccountRequest = z.infer<typeof mobileFacebookAccountRequestSchema>;
