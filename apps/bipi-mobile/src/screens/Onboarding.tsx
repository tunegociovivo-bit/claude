import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";

export function Onboarding() {
  const nav = useNavigation<any>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!email.includes("@")) {
      Alert.alert("Email inválido");
      return;
    }
    setBusy(true);
    try {
      // 1) Permisos críticos antes del signup
      await Location.requestForegroundPermissionsAsync();
      await Notifications.requestPermissionsAsync();
      // 2) Alta
      const r = await api.customerSignup(email.trim(), name.trim());
      await saveSession({
        customerId: r.customerId,
        name: r.name,
        email,
        totalSaved: r.totalSaved ?? 0,
        totalPurchases: r.totalPurchases ?? 0
      });
      nav.reset({ index: 0, routes: [{ name: "Feed" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear la cuenta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>
        <Text style={styles.accent}>bi</Text>pi
      </Text>
      <Text style={styles.tag}>Tus descuentos en el barrio.</Text>
      <Text style={styles.tag}>Escanea. Paga. Descubre.</Text>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="Tu nombre"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.btn, busy && { opacity: 0.5 }]}
          onPress={go}
          disabled={busy}
        >
          <Text style={styles.btnText}>{busy ? "Creando…" : "Entrar a Bipi"}</Text>
        </TouchableOpacity>
        <Text style={styles.legal}>
          Sin tarjetas. Sin puntos. Sin spam. Cada compra en un negocio Bipi te abre descuentos en otros cerca.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 80, paddingHorizontal: 24, backgroundColor: "#FDF2E1" },
  brand: { fontSize: 64, fontWeight: "900", color: "#3D2A1B", textAlign: "center" },
  accent: { color: "#C8612C" },
  tag: { color: "#7A5C3E", textAlign: "center", fontSize: 14 },
  card: { marginTop: 30, backgroundColor: "#FFF", padding: 16, borderRadius: 16, gap: 12, elevation: 2 },
  input: { borderColor: "#E5D3B7", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, backgroundColor: "#FFF" },
  btn: { backgroundColor: "#C8612C", borderRadius: 999, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  legal: { fontSize: 11, color: "#9B7B5C", textAlign: "center", marginTop: 6 }
});
