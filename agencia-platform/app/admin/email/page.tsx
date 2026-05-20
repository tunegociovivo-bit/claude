import { redirect } from "next/navigation";

// El correo es una configuración PERSONAL de cada trabajador, no admin.
// Su sitio canónico es /perfil/correo (accesible a todos los usuarios).
export default function AdminEmailRedirect() {
  redirect("/perfil/correo");
}
