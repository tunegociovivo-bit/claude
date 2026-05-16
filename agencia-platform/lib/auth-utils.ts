import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function getCurrentRole(): Promise<"ADMIN" | "MEMBER" | null> {
  const s = await getServerSession(authOptions);
  const role = (s?.user as any)?.role;
  if (role === "ADMIN") return "ADMIN";
  if (role === "MEMBER") return "MEMBER";
  return null;
}

export async function isAdmin(): Promise<boolean> {
  return (await getCurrentRole()) === "ADMIN";
}
