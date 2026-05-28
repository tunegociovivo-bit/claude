import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { colors, radius, shadow } from "../lib/theme";

const SLIDES = [
  {
    emoji: "🎟",
    title: "Cada compra te abre descuentos cerca",
    body: "Escaneas el QR del negocio al pagar y se te abren 3-5 cupones en otros negocios del barrio."
  },
  {
    emoji: "✨",
    title: "Limpio. Directo. Sin trucos.",
    body: "Sin cartera, sin puntos, sin spam, sin tarjetas. El descuento se aplica al confirmar tu compra."
  },
  {
    emoji: "💖",
    title: "Apoya el comercio del barrio",
    body: "Cada euro que gastas en Bipi se queda en tu barrio. Negocios locales, no cadenas."
  }
];

export function Onboarding() {
  const nav = useNavigation<any>();
  const [step, setStep] = useState(0); // 0..2 slides, 3 = signup
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
      await Location.requestForegroundPermissionsAsync();
      await Notifications.requestPermissionsAsync();
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

  // Pantallas de intro
  if (step < SLIDES.length) {
    const s = SLIDES[step];
    const isLast = step === SLIDES.length - 1;
    return (
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Wordmark size={32} />
          <TouchableOpacity onPress={() => setStep(SLIDES.length)}>
            <Text style={styles.skip}>Saltar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.slideBody}>
          <Text style={{ fontSize: 84 }}>{s.emoji}</Text>
          <Text style={styles.slideTitle}>{s.title}</Text>
          <Text style={styles.slideText}>{s.body}</Text>
        </View>

        <View style={{ gap: 16 }}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === step && styles.dotActive]}
              />
            ))}
          </View>
          <TouchableOpacity style={styles.btn} onPress={() => setStep(step + 1)}>
            <Text style={styles.btnText}>{isLast ? "Crear mi cuenta" : "Siguiente"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Signup
  return (
    <ScrollView contentContainerStyle={styles.signupRoot}>
      <View style={{ alignItems: "center" }}>
        <Wordmark size={64} />
        <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
      </View>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="Tu nombre"
          placeholderTextColor={colors.grayLight}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.grayLight}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TouchableOpacity style={[styles.btn, busy && { opacity: 0.5 }]} onPress={go} disabled={busy}>
          <Text style={styles.btnText}>{busy ? "Creando…" : "Entrar a Bipi"}</Text>
        </TouchableOpacity>
        <Text style={styles.legal}>
          Sin tarjetas. Sin puntos. Sin spam. Cada compra en un negocio Bipi te abre descuentos en otros cerca.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 60, paddingHorizontal: 24, paddingBottom: 40, backgroundColor: colors.white },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  skip: { color: colors.gray, fontSize: 13, fontWeight: "700" },
  slideBody: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
  slideTitle: { fontSize: 26, fontWeight: "900", color: colors.black, textAlign: "center", letterSpacing: -0.5 },
  slideText: { fontSize: 15, color: colors.gray, textAlign: "center", lineHeight: 22, paddingHorizontal: 8 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.15)" },
  dotActive: { width: 24, backgroundColor: colors.pink },
  signupRoot: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 60, backgroundColor: colors.white, flexGrow: 1 },
  tag: { color: colors.black, textAlign: "center", fontSize: 15, fontWeight: "800", marginTop: 12 },
  card: { marginTop: 30, backgroundColor: colors.white, padding: 18, borderRadius: radius.xl, gap: 12, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  input: { borderColor: "#E5E7EB", borderWidth: 2, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: colors.white, color: colors.black },
  btn: { backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 15, alignItems: "center", ...shadow.btn },
  btnText: { color: colors.white, fontWeight: "800", fontSize: 16 },
  legal: { fontSize: 11, color: colors.gray, textAlign: "center", marginTop: 6, lineHeight: 16 }
});
