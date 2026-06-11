/**
 * Ubicación actual con el permiso pedido COMO MÁXIMO una vez por sesión de app.
 *
 * Pedir el permiso (request…) en cada load/focus provocaba en Android:
 *  - bucle de diálogos en MIUI con "Preguntar siempre": diálogo → la app pasa
 *    a background → al cerrarse vuelve a "active" → load() → otro diálogo…,
 *    con parpadeo de la barra de estado hasta que el sistema mata la app;
 *  - conflicto con la petición de cámara de Scan (dos peticiones concurrentes:
 *    la segunda nunca se resuelve y la pantalla queda en "Pidiendo permiso…").
 *
 * Por eso: get… siempre; request… solo la primera vez por sesión.
 */
import * as Location from "expo-location";

let asked = false;

export async function getCurrentLatLng(): Promise<{ lat?: number; lng?: number }> {
  try {
    let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted" && canAskAgain && !asked) {
      asked = true;
      status = (await Location.requestForegroundPermissionsAsync()).status;
    }
    if (status !== "granted") return {};
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return {};
  }
}
