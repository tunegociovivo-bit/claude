import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { colors, radius, shadow } from "../lib/theme";

const AMBER = "#F59E0B";

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

type Feature = { icon: string; label: string; sub?: string };
type Slide = {
  scene: "coupon" | "sparkle" | "heart";
  title: React.ReactNode;
  subtitle: string;
  features: Feature[];
  note?: string;
  cta: string;
};

const SLIDES: Slide[] = [
  {
    scene: "coupon",
    title: (
      <>
        Cada compra{"\n"}
        <Text style={{ color: colors.pink }}>te abre descuentos cerca</Text>
      </>
    ),
    subtitle: "Escaneas el QR del negocio al pagar y se te abren 3-5 cupones en otros negocios del barrio.",
    features: [
      { icon: "📷", label: "Escanea", sub: "el QR al pagar" },
      { icon: "🎟", label: "Recibe", sub: "3-5 cupones cerca" },
      { icon: "💗", label: "Disfruta", sub: "descuentos cerca" }
    ],
    cta: "Siguiente"
  },
  {
    scene: "sparkle",
    title: (
      <>
        Limpio. <Text style={{ color: colors.pink }}>Directo.</Text> Sin trucos.
      </>
    ),
    subtitle: "Sin complicaciones: el descuento se aplica solo cuando el negocio confirma tu compra.",
    features: [
      { icon: "💳", label: "Sin cartera" },
      { icon: "⭐", label: "Sin puntos" },
      { icon: "🛡", label: "Sin spam" }
    ],
    note: "Sin tarjetas. El descuento se aplica al confirmar tu compra.",
    cta: "Siguiente"
  },
  {
    scene: "heart",
    title: (
      <>
        Apoya el <Text style={{ color: colors.pink }}>comercio</Text> del barrio
      </>
    ),
    subtitle: "Cada euro que gastas en Bubui se queda en tu barrio. Negocios locales, no cadenas.",
    features: [
      { icon: "🏪", label: "Impulsa", sub: "los negocios locales" },
      { icon: "👥", label: "Fortalece", sub: "tu comunidad" },
      { icon: "💖", label: "Genera", sub: "un impacto real" }
    ],
    cta: "Crear mi cuenta"
  }
];

export function Onboarding() {
  const nav = useNavigation<any>();
  const [step, setStep] = useState(0); // 0..2 slides, 3 = signup
  const [otpStep, setOtpStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    if (!name.trim()) { Alert.alert("Pon tu nombre"); return; }
    if (phone.trim().length < 6) { Alert.alert("Teléfono inválido"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { Alert.alert("Email inválido"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) { Alert.alert("Fecha", "Usa el formato AAAA-MM-DD"); return; }
    if (!gender) { Alert.alert("Indica tu sexo"); return; }
    setBusy(true);
    try {
      await api.requestOtp(phone.trim());
      setOtpStep("code");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar el código");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const r = await api.verifyOtp({
        phone: phone.trim(),
        code: code.trim(),
        name: name.trim(),
        email: email.trim(),
        birthDate: birthDate.trim(),
        gender
      });
      await Location.requestForegroundPermissionsAsync();
      await Notifications.requestPermissionsAsync();
      await saveSession({
        customerId: r.customerId,
        name: r.name,
        email: email.trim() || undefined,
        totalSaved: r.totalSaved ?? 0,
        totalPurchases: r.totalPurchases ?? 0
      });
      nav.reset({ index: 0, routes: [{ name: "Feed" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Código incorrecto");
    } finally {
      setBusy(false);
    }
  }

  // Slides de intro
  if (step < SLIDES.length) {
    const s = SLIDES[step];
    return (
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Wordmark size={30} />
          <TouchableOpacity onPress={() => setStep(SLIDES.length)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skip}>Saltar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.slideBody}>
          <Scene kind={s.scene} />

          <Text style={styles.slideTitle}>{s.title}</Text>
          <Text style={styles.slideText}>{s.subtitle}</Text>

          <View style={styles.features}>
            {s.features.map((f, i) => (
              <View key={i} style={styles.featureCard}>
                <View style={styles.featureIconWrap}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                </View>
                <Text style={styles.featureLabel}>{f.label}</Text>
                {!!f.sub && <Text style={styles.featureSub}>{f.sub}</Text>}
              </View>
            ))}
          </View>

          {!!s.note && (
            <View style={styles.note}>
              <Text style={styles.noteIcon}>🏷️</Text>
              <Text style={styles.noteText}>{s.note}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity style={styles.btn} onPress={() => setStep(step + 1)} activeOpacity={0.9}>
            <Text style={styles.btnText}>{s.cta}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Signup con verificación por teléfono
  return (
    <ScrollView contentContainerStyle={styles.signupRoot}>
      <View style={{ alignItems: "center" }}>
        <Wordmark size={64} />
        <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
      </View>

      {otpStep === "form" ? (
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
            placeholder="Teléfono móvil"
            placeholderTextColor={colors.grayLight}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
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
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 16, color: birthDate ? colors.black : colors.grayLight }}>
              {birthDate ? `📅  ${fmtDateHuman(birthDate)}` : "Fecha de nacimiento"}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={birthDate ? new Date(birthDate) : new Date(1995, 0, 1)}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "calendar"}
              maximumDate={new Date()}
              minimumDate={new Date(1920, 0, 1)}
              onChange={(event, date) => {
                setShowDatePicker(Platform.OS === "ios");
                if (event.type === "set" && date) setBirthDate(fmtDate(date));
              }}
            />
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { v: "female", l: "Mujer" },
              { v: "male", l: "Hombre" },
              { v: "other", l: "Otro" },
              { v: "prefer_not", l: "Prefiero no decirlo" }
            ].map((g) => (
              <TouchableOpacity
                key={g.v}
                onPress={() => setGender(g.v)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: gender === g.v ? colors.pink : "#E5E7EB",
                  backgroundColor: gender === g.v ? colors.pink : colors.white
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: gender === g.v ? colors.white : colors.black }}>{g.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.5 }]} onPress={sendCode} disabled={busy} activeOpacity={0.9}>
            <Text style={styles.btnText}>{busy ? "Enviando…" : "Enviar código SMS"}</Text>
          </TouchableOpacity>
          <Text style={styles.legal}>
            Te enviaremos un SMS con un código para verificar tu número. Sin tarjetas, sin spam.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={{ color: colors.gray, fontSize: 13, textAlign: "center" }}>
            Introduce el código SMS enviado a {phone}
          </Text>
          <TextInput
            style={[styles.input, { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "800" }]}
            placeholder="••••••"
            placeholderTextColor={colors.grayLight}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 8))}
            keyboardType="number-pad"
            autoFocus
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
          />
          <TouchableOpacity style={[styles.btn, (busy || code.length < 4) && { opacity: 0.5 }]} onPress={verify} disabled={busy || code.length < 4} activeOpacity={0.9}>
            <Text style={styles.btnText}>{busy ? "Verificando…" : "Verificar y entrar"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setOtpStep("form"); setCode(""); }}>
            <Text style={{ color: colors.gray, fontSize: 12, textAlign: "center" }}>← Cambiar número o reenviar</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

/* ── Escena ilustrada (círculo rosa + confeti + foco) ───────────────── */
function Scene({ kind }: { kind: Slide["scene"] }) {
  return (
    <View style={styles.scene}>
      {/* Anillos concéntricos suaves */}
      <View style={[styles.ring, { width: 230, height: 230, opacity: 0.5 }]} />
      <View style={[styles.ring, { width: 170, height: 170, opacity: 0.7 }]} />

      {/* Confeti */}
      <Confetti />

      {/* Casas/tiendas al fondo en slides de barrio */}
      {kind !== "sparkle" && (
        <>
          <Text style={[styles.shop, { left: 18, bottom: 14 }]}>🏪</Text>
          <Text style={[styles.shop, { right: 18, bottom: 14 }]}>🏬</Text>
        </>
      )}

      {/* Foco */}
      {kind === "coupon" && <CouponGraphic />}
      {kind === "sparkle" && <SparkleBadge />}
      {kind === "heart" && (
        <View style={styles.heartWrap}>
          <Text style={styles.heartGlyph}>💖</Text>
        </View>
      )}
    </View>
  );
}

function CouponGraphic() {
  return (
    <View style={styles.coupon}>
      <View style={styles.couponNotchLeft} />
      <View style={styles.couponNotchRight} />
      <Text style={styles.couponPct}>%</Text>
      <Text style={styles.couponSpark}>✨</Text>
    </View>
  );
}

function SparkleBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeGlyph}>✨</Text>
    </View>
  );
}

function Confetti() {
  // Puntos y rayas decorativas en rosa + ámbar.
  const dots = [
    { top: 18, left: 40, c: colors.pink, s: 7 },
    { top: 34, right: 46, c: AMBER, s: 9 },
    { bottom: 40, left: 30, c: AMBER, s: 6 },
    { bottom: 26, right: 38, c: colors.pink, s: 8 },
    { top: 60, left: 14, c: colors.pinkDeep, s: 5 },
    { top: 70, right: 18, c: colors.pink, s: 6 }
  ];
  return (
    <>
      {dots.map((d, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            width: d.s,
            height: d.s,
            borderRadius: d.s / 2,
            backgroundColor: d.c,
            top: (d as any).top,
            bottom: (d as any).bottom,
            left: (d as any).left,
            right: (d as any).right,
            opacity: 0.85
          }}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 56, paddingHorizontal: 22, paddingBottom: 36, backgroundColor: colors.white },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  skip: { color: colors.gray, fontSize: 14, fontWeight: "700" },

  slideBody: { flex: 1, justifyContent: "center", alignItems: "center" },

  // Escena
  scene: {
    width: "100%",
    height: 220,
    borderRadius: 28,
    backgroundColor: colors.pinkWash,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 28
  },
  ring: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(236,72,153,0.06)" },
  shop: { position: "absolute", fontSize: 34, opacity: 0.35 },

  coupon: {
    width: 168,
    height: 96,
    borderRadius: 16,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-7deg" }],
    ...shadow.btn
  },
  couponPct: { color: colors.white, fontSize: 52, fontWeight: "900" },
  couponSpark: { position: "absolute", top: 8, right: 12, fontSize: 18 },
  couponNotchLeft: {
    position: "absolute", left: -9, top: 39, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.pinkWash
  },
  couponNotchRight: {
    position: "absolute", right: -9, top: 39, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.pinkWash
  },

  badge: {
    width: 124, height: 124, borderRadius: 62, backgroundColor: colors.white,
    alignItems: "center", justifyContent: "center", ...shadow.card
  },
  badgeGlyph: { fontSize: 58 },

  heartWrap: { alignItems: "center", justifyContent: "center" },
  heartGlyph: { fontSize: 96 },

  slideTitle: { fontSize: 25, fontWeight: "900", color: colors.black, textAlign: "center", letterSpacing: -0.5, lineHeight: 31 },
  slideText: { fontSize: 14, color: colors.gray, textAlign: "center", lineHeight: 21, paddingHorizontal: 6, marginTop: 10 },

  // Mini-tarjetas
  features: { flexDirection: "row", gap: 10, marginTop: 22, alignSelf: "stretch" },
  featureCard: {
    flex: 1, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 14, paddingHorizontal: 8, alignItems: "center", ...shadow.card
  },
  featureIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pinkWash,
    alignItems: "center", justifyContent: "center", marginBottom: 8
  },
  featureIcon: { fontSize: 20 },
  featureLabel: { fontSize: 13, fontWeight: "800", color: colors.black, textAlign: "center" },
  featureSub: { fontSize: 10, color: colors.gray, textAlign: "center", marginTop: 2, lineHeight: 13 },

  note: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, alignSelf: "stretch",
    backgroundColor: colors.pinkWash, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14
  },
  noteIcon: { fontSize: 16 },
  noteText: { flex: 1, fontSize: 12, color: colors.pinkDeep, fontWeight: "600", lineHeight: 17 },

  // Footer
  footer: { gap: 18 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.15)" },
  dotActive: { width: 24, backgroundColor: colors.pink },
  btn: { backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
  btnText: { color: colors.white, fontWeight: "800", fontSize: 16 },

  // Signup
  signupRoot: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 60, backgroundColor: colors.white, flexGrow: 1 },
  tag: { color: colors.black, textAlign: "center", fontSize: 15, fontWeight: "800", marginTop: 12 },
  card: { marginTop: 30, backgroundColor: colors.white, padding: 18, borderRadius: radius.xl, gap: 12, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  input: { borderColor: "#E5E7EB", borderWidth: 2, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: colors.white, color: colors.black },
  legal: { fontSize: 11, color: colors.gray, textAlign: "center", marginTop: 6, lineHeight: 16 }
});
