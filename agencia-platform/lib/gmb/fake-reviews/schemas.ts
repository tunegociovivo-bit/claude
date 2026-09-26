import { z } from "zod";

/** Ficha de Google tal como la devuelve el buscador del detector. */
export const placeSchema = z.object({
  title: z.string().min(1).max(300),
  address: z.string().max(500).optional().default(""),
  rating: z.number().nullable().optional(),
  reviews: z.number().int().nullable().optional(),
  type: z.string().max(200).optional().default(""),
  dataId: z.string().max(100).optional().default(""),
  placeId: z.string().max(200).optional().default(""),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  thumbnail: z.string().max(2000).optional().default("")
}).refine((p) => !!(p.dataId || p.placeId), "La ficha no tiene identificador de Google (data_id/place_id)");
