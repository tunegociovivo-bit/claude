// El panel admin de Bubui usa su propia auth (BUBUI_ADMIN_TOKEN via TokenForm
// en BubuiAdminClient). No depende de la sesión del Hub, por lo que esta
// página es pública — la protección real está en las APIs /api/bubui/admin/*.
import BubuiAdminClient from "./BubuiAdminClient";

export const dynamic = "force-dynamic";

export default function BubuiAdminPage() {
  return <BubuiAdminClient />;
}
