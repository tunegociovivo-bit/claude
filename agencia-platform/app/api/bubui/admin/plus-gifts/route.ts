/**
 * Admin · Regalos Plus (CRUD).
 *   GET    → lista todos los regalos (activos e inactivos).
 *   POST   → crea un regalo.
 *   PATCH  → actualiza un regalo { id, ...campos }.
 *   DELETE → elimina un regalo (?id=...).
 *
 * Auth: sesión admin (NextAuth, role ADMIN) como el resto del panel.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminTokenOk } from "@/lib/bubui/admin";
import { listPlusGifts, createPlusGift, updatePlusGift, deletePlusGift } from "@/lib/bubui/plus-gifts";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional(),
  link: z.string().max(2000).optional(),
  order: z.number().int().optional(),
  active: z.boolean().optional()
});

const patchSchema = createSchema.partial().extend({ id: z.string().min(1) });

export async function GET(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return NextResponse.json({ gifts: await listPlusGifts() });
}

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  return NextResponse.json(await createPlusGift(parsed.data));
}

export async function PATCH(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const { id, ...data } = parsed.data;
  return NextResponse.json(await updatePlusGift(id, data));
}

export async function DELETE(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  await deletePlusGift(id);
  return NextResponse.json({ ok: true });
}
