import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAuth } from "./api";

export type Customer = {
  customerId: string;
  name?: string;
  email?: string;
  totalSaved: number;
  totalPurchases: number;
  // Token de sesión emitido por el backend al verificar OTP / hacer login.
  token?: string;
};

const KEY = "bubui.customer";

export async function CheckSession(): Promise<Customer | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Customer;
    // Sesiones antiguas (de antes del token) se consideran caducadas: se
    // fuerza re-login para que obtengan un token y queden autenticadas.
    if (!c.token) {
      await AsyncStorage.removeItem(KEY);
      setAuth(null);
      return null;
    }
    setAuth({ customerId: c.customerId, token: c.token });
    return c;
  } catch {
    return null;
  }
}

export async function saveSession(c: Customer): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(c));
  setAuth(c.token ? { customerId: c.customerId, token: c.token } : null);
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  setAuth(null);
}
