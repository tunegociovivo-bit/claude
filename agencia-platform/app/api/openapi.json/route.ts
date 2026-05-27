import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi";

export function GET() {
  return NextResponse.json(openApiSpec);
}
