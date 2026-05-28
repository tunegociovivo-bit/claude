import AsyncStorage from "@react-native-async-storage/async-storage";

export type Customer = {
  customerId: string;
  name?: string;
  email?: string;
  totalSaved: number;
  totalPurchases: number;
};

const KEY = "bubui.customer";

export async function CheckSession(): Promise<Customer | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Customer) : null;
  } catch {
    return null;
  }
}

export async function saveSession(c: Customer): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(c));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
