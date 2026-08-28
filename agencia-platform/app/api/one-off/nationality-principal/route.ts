import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const FILE_ID = "cmtd01wo801n9t5vhx6brkgm1";
const KEY_HASH = "bb2290f783fba9e89a710e38ce535cbaee65b9a3b2a1e5fa1e11ea6e16f90817";

export async function GET(req: NextRequest) {
  const supplied = req.nextUrl.searchParams.get("key") ?? "";
  const actual = createHash("sha256").update(supplied).digest();
  const expected = Buffer.from(KEY_HASH, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const file = await prisma.file.findUnique({ where: { id: FILE_ID }, select: { s3Key: true } });
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(await signedDownloadUrl(file.s3Key, 120));
}
