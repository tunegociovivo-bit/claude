import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";

export async function GET() {
  try {
    const operator = await requireOperator();
    return NextResponse.json({ ok: true, email: operator.email });
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
}
