import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { effectiveFeatures, type Feature } from "@/lib/features";
import { redirect } from "next/navigation";

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

// Devuelve las features efectivas del usuario logueado leyendo el
// Membership.features (null = defaults del rol). Si no hay sesión,
// devuelve [].
export async function getMyFeatures(): Promise<Feature[]> {
  const s = await getServerSession(authOptions);
  const userId = (s?.user as any)?.id;
  const workspaceId = (s?.user as any)?.workspaceId;
  if (!userId || !workspaceId) return [];
  const m = await prisma.membership.findFirst({
    where: { userId, workspaceId },
    select: { role: true, features: true } as any
  });
  if (!m) return [];
  return effectiveFeatures((m as any).role, (m as any).features ?? null);
}

// Para usar en page.tsx server components: si el usuario no tiene la
// feature, redirige a la primera feature que SÍ tenga (para evitar
// loops cuando el inicio también está restringido). Si no hay sesión,
// deja pasar (la propia page o el middleware se encargarán de redirigir
// a login). Si el usuario no tiene NINGUNA feature, redirige a /perfil.
const FEATURE_TO_PATH: Record<Feature, string> = {
  inicio: "/",
  tareas: "/tareas",
  clientes: "/clientes",
  equipo: "/equipo",
  documentos: "/documentos",
  databases: "/databases",
  calendario: "/calendario",
  editorial: "/admin/editorial",
  ia: "/"
};

export async function requireFeature(feature: Feature): Promise<void> {
  const s = await getServerSession(authOptions);
  if (!s?.user) return; // delegamos auth en la page
  const features = await getMyFeatures();
  if (features.includes(feature)) return;
  // Buscar destino seguro distinto al actual.
  const fallback = features.find((f) => f !== feature);
  if (fallback) redirect(FEATURE_TO_PATH[fallback] ?? "/perfil");
  redirect("/perfil");
}
