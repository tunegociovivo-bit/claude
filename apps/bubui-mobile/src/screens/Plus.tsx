import { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Alert, Image } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CheckSession } from "../lib/session";
import { api } from "../lib/api";
import { FadeIn } from "../components/FadeIn";
import { Gradient } from "../components/Gradient";
import { sfx } from "../lib/sound";
import { useTheme, type Palette, radius, shadow, gradients } from "../lib/theme";

/** Ventajas del plan (lo que se muestra como propuesta de valor). */
const PERKS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: "flash", title: "Acceso anticipado", sub: "Ves y reservas las mejores ofertas antes que nadie." },
  { icon: "gift", title: "Regalos exclusivos", sub: "Sorpresas y regalos solo para suscriptores Plus." },
  { icon: "star", title: "Prioridad", sub: "Siempre primero en los descuentos más jugosos." }
];

export function Plus() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [plusActive, setPlusActive] = useState(false);
  const [plusEnabled, setPlusEnabled] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gifts, setGifts] = useState<{ id: string; title: string; description: string | null; imageUrl: string | null; link: string | null }[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding", params: { start: "register" } }] }); return; }
        setCustomerId(s.customerId);
        api
          .customerSummary(s.customerId)
          .then((live) => {
            setPlusActive(!!live.plusActive);
            setPlusEnabled(!!live.plusEnabled);
            setCancelAt(live.subscriptionCancelAt ?? null);
          })
          .catch(() => {});
        api
          .plusGifts(s.customerId)
          .then((d) => setGifts(d.plusActive ? d.gifts : []))
          .catch(() => {});
      })();
    }, [nav])
  );

  async function subscribe() {
    if (!customerId || busy) return;
    setBusy(true);
    try {
      const out = await api.plusCheckout(customerId);
      // El cobro ocurre en la web (Stripe). Abrimos el navegador.
      await Linking.openURL(out.url);
    } catch (e: any) {
      Alert.alert("Bubui Plus", e?.message ?? "No se pudo iniciar la suscripción. Inténtalo más tarde.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!customerId || busy) return;
    Alert.alert("Cancelar Bubui Plus", "Seguirás siendo Plus hasta el final del periodo ya pagado. ¿Cancelar la renovación?", [
      { text: "No", style: "cancel" },
      {
        text: "Sí, cancelar",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const out = await api.cancelPlus(customerId);
            setCancelAt(out.cancelAt ?? null);
          } catch (e: any) {
            Alert.alert("Bubui Plus", e?.message ?? "No se pudo cancelar.");
          } finally {
            setBusy(false);
          }
        }
      }
    ]);
  }

  async function resume() {
    if (!customerId || busy) return;
    setBusy(true);
    try {
      await api.cancelPlus(customerId, true);
      setCancelAt(null);
    } catch (e: any) {
      Alert.alert("Bubui Plus", e?.message ?? "No se pudo reactivar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
          <Gradient colors={gradients.hero} style={StyleSheet.absoluteFill} />
          <TouchableOpacity style={styles.closeBtn} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Feed"))} hitSlop={8}>
            <Text style={styles.closeText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.crown}>👑</Text>
          <Text style={styles.title}>Bubui Plus</Text>
          <Text style={styles.subtitle}>Las mejores ofertas, regalos exclusivos y prioridad.</Text>
        </View>

        <View style={styles.body}>
          <FadeIn replayOnFocus>
            {PERKS.map((p, i) => (
              <View key={i} style={styles.perk}>
                <View style={styles.perkIcon}><Ionicons name={p.icon} size={20} color={c.pink} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perkTitle}>{p.title}</Text>
                  <Text style={styles.perkSub}>{p.sub}</Text>
                </View>
              </View>
            ))}
          </FadeIn>

          {plusActive ? (
            <View style={styles.activeBox}>
              <Text style={styles.activeText}>✅ Ya eres Bubui Plus</Text>
              {cancelAt ? (
                <>
                  <Text style={styles.activeSub}>Tu plan no se renovará. Sigues Plus hasta el final del periodo.</Text>
                  <TouchableOpacity style={styles.ghostBtn} onPress={resume} disabled={busy}>
                    <Text style={styles.ghostBtnText}>Reactivar renovación</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.ghostBtn} onPress={cancel} disabled={busy}>
                  <Text style={styles.ghostBtnText}>Cancelar suscripción</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : plusEnabled ? (
            <>
              <Text style={styles.price}>1 €<Text style={styles.priceUnit}> /mes</Text></Text>
              <TouchableOpacity style={styles.ctaWrap} onPress={() => { sfx.tap(); subscribe(); }} activeOpacity={0.9} disabled={busy}>
                <Gradient colors={gradients.hero} style={styles.cta}>
                  <Text style={styles.ctaText}>{busy ? "Abriendo…" : "Hazte Plus por 1€/mes"}</Text>
                </Gradient>
              </TouchableOpacity>
              <Text style={styles.legal}>El pago se realiza de forma segura en bubui.app. Puedes cancelar cuando quieras.</Text>
            </>
          ) : (
            <View style={styles.soonBox}>
              <Text style={styles.soonText}>Muy pronto 🚀</Text>
              <Text style={styles.soonSub}>Bubui Plus estará disponible en cuanto haya más comercios cerca de ti. ¡Estate atento!</Text>
            </View>
          )}

          {plusActive && gifts.length > 0 && (
            <View style={styles.giftsSection}>
              <Text style={styles.giftsHeader}>🎁 Tus regalos Plus</Text>
              {gifts.map((g) => {
                const Row = (
                  <View style={styles.gift}>
                    {g.imageUrl ? (
                      <Image source={{ uri: g.imageUrl }} style={styles.giftImg} />
                    ) : (
                      <View style={styles.giftImgPlaceholder}><Text style={{ fontSize: 22 }}>🎁</Text></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.giftTitle}>{g.title}</Text>
                      {!!g.description && <Text style={styles.giftSub}>{g.description}</Text>}
                    </View>
                    {!!g.link && <Text style={styles.giftChev}>›</Text>}
                  </View>
                );
                return g.link ? (
                  <TouchableOpacity key={g.id} activeOpacity={0.8} onPress={() => Linking.openURL(g.link!)}>{Row}</TouchableOpacity>
                ) : (
                  <View key={g.id}>{Row}</View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    hero: { alignItems: "center", justifyContent: "flex-end", paddingBottom: 26, paddingHorizontal: 24, minHeight: 220, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
    closeBtn: { position: "absolute", left: 14, top: 0, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
    closeText: { fontSize: 26, fontWeight: "900", color: "#0A0A0A", marginTop: -2 },
    crown: { fontSize: 52, marginBottom: 6 },
    title: { fontSize: 30, fontWeight: "900", color: "#fff", letterSpacing: -0.5 },
    subtitle: { fontSize: 14, color: "rgba(255,255,255,0.92)", textAlign: "center", marginTop: 6, lineHeight: 20 },
    body: { paddingHorizontal: 20, paddingTop: 22 },
    perk: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 12, ...shadow.card },
    perkIcon: { height: 40, width: 40, borderRadius: 20, backgroundColor: c.pinkWash, alignItems: "center", justifyContent: "center" },
    perkTitle: { fontSize: 15, fontWeight: "900", color: c.black },
    perkSub: { fontSize: 12.5, color: c.gray, marginTop: 2, lineHeight: 17 },
    price: { fontSize: 40, fontWeight: "900", color: c.black, textAlign: "center", marginTop: 14, letterSpacing: -1 },
    priceUnit: { fontSize: 16, fontWeight: "700", color: c.gray },
    ctaWrap: { alignSelf: "stretch", marginTop: 16, borderRadius: radius.pill, ...shadow.btn },
    cta: { borderRadius: radius.pill, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
    ctaText: { color: "#fff", fontSize: 16.5, fontWeight: "800" },
    legal: { fontSize: 11.5, color: c.grayLight, textAlign: "center", marginTop: 12, lineHeight: 16 },
    activeBox: { backgroundColor: c.pinkWash, borderRadius: radius.lg, borderWidth: 1, borderColor: c.pinkSoft, padding: 18, marginTop: 8, alignItems: "center" },
    activeText: { fontSize: 17, fontWeight: "900", color: c.pinkDeep },
    activeSub: { fontSize: 13, color: c.ink, textAlign: "center", marginTop: 6, lineHeight: 18 },
    ghostBtn: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 22, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.white },
    ghostBtnText: { fontSize: 13.5, fontWeight: "800", color: c.ink },
    giftsSection: { marginTop: 26 },
    giftsHeader: { fontSize: 16, fontWeight: "900", color: c.black, marginBottom: 12 },
    gift: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 10, ...shadow.card },
    giftImg: { height: 48, width: 48, borderRadius: 12, backgroundColor: c.bg },
    giftImgPlaceholder: { height: 48, width: 48, borderRadius: 12, backgroundColor: c.pinkWash, alignItems: "center", justifyContent: "center" },
    giftTitle: { fontSize: 14.5, fontWeight: "800", color: c.black },
    giftSub: { fontSize: 12, color: c.gray, marginTop: 2, lineHeight: 16 },
    giftChev: { fontSize: 22, color: c.pink, fontWeight: "900" },
    soonBox: { backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 14, alignItems: "center", ...shadow.card },
    soonText: { fontSize: 18, fontWeight: "900", color: c.black },
    soonSub: { fontSize: 13, color: c.gray, textAlign: "center", marginTop: 6, lineHeight: 19 }
  });
