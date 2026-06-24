import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Alert } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckSession, saveSession, clearSession, type Customer } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { Bouncy } from "../components/Bouncy";
import { CountUp } from "../components/CountUp";
import { Gradient } from "../components/Gradient";
import { stagger } from "../lib/anim";
import { api, API_BASE } from "../lib/api";
import { useTheme, type Palette, radius, shadow, gradients } from "../lib/theme";

export function Cuenta() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [plusActive, setPlusActive] = useState(false);
  const [plusEnabled, setPlusEnabled] = useState(false);
  const [wallet, setWallet] = useState<{ pct: number; expiresAt: string | null } | null>(null);
  const [refCode, setRefCode] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        // Invitado (sin sesión): llevar directamente a la pantalla de registro.
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding", params: { start: "register" } }] }); return; }
        setCustomer(s);
        // Stats vivas (ahorro/compras se actualizan cuando el negocio
        // confirma): pinta la caché al instante y refresca en segundo plano.
        api
          .customerSummary(s.customerId)
          .then(async (live) => {
            const updated = { ...s, name: live.name ?? s.name, totalSaved: live.totalSaved, totalPurchases: live.totalPurchases };
            setCustomer(updated);
            setPlusActive(!!live.plusActive);
            setPlusEnabled(!!live.plusEnabled);
            setWallet({ pct: live.referralWalletPct ?? 0, expiresAt: live.referralWalletExpiresAt ?? null });
            await saveSession(updated).catch(() => {});
          })
          .catch(() => {});
        // Código de referido para el enlace de invitación.
        api.referral(s.customerId).then((r) => setRefCode(r.code)).catch(() => {});
      })();
    }, [nav])
  );

  const initial = (customer?.name ?? customer?.email ?? "?").charAt(0).toUpperCase();
  // Nivel del cliente según compras confirmadas (gamificación ligera).
  const purchases = customer?.totalPurchases ?? 0;
  const tier = purchases >= 30 ? "⭐ Miembro Oro" : purchases >= 10 ? "✨ Miembro Plata" : "🌱 Miembro Bronce";

  async function logout() {
    await clearSession().catch(() => {});
    nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
  }

  function inviteFriends() {
    const link = refCode ? `${API_BASE}/bubui/r/${refCode}` : "https://bubui.app";
    const text = `¡Descubre Bubui y llévate descuentos en negocios del barrio! 🎁 ${link}`;
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => {});
  }

  async function doDelete(id: string) {
    try {
      await api.deleteAccount(id);
      await clearSession().catch(() => {});
      Alert.alert("Cuenta eliminada", "Tu cuenta y tus datos se han eliminado.");
      nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo eliminar la cuenta. Inténtalo de nuevo.");
    }
  }

  function confirmDelete() {
    if (!customer) return;
    const id = customer.customerId;
    // Apple 5.1.1(v): borrado desde la app con confirmación (doble) y definitivo.
    Alert.alert(
      "Eliminar tu cuenta",
      "Se borrarán de forma permanente tu perfil, tus cupones, tu historial de ahorro y tus datos. Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () =>
            Alert.alert("Confirmación final", "Esto es definitivo. ¿Eliminar la cuenta?", [
              { text: "Cancelar", style: "cancel" },
              { text: "Sí, eliminar", style: "destructive", onPress: () => void doDelete(id) }
            ])
        }
      ]
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Cabecera hero con gradiente de marca, avatar y nivel */}
        <FadeIn replayOnFocus dy={0}>
          <Gradient colors={gradients.brand} style={[styles.hero, { paddingTop: insets.top + 18 }]}>
            <Wordmark size={24} />
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.name}>{customer?.name ?? "Cliente Bubui"}</Text>
            {!!customer?.email && <Text style={styles.sub}>{customer.email}</Text>}
            <View style={styles.tier}><Text style={styles.tierText}>{tier}</Text></View>
          </Gradient>
        </FadeIn>

        <View style={styles.body}>
          {/* Stats — superpuestas sobre el hero */}
          <FadeIn replayOnFocus delay={stagger(1)} style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>💸</Text>
              <CountUp value={customer?.totalSaved ?? 0} decimals={2} suffix=" €" style={styles.statValue} />
              <Text style={styles.statLabel}>HAS AHORRADO</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>🛍️</Text>
              <CountUp value={customer?.totalPurchases ?? 0} decimals={0} style={styles.statValue} />
              <Text style={styles.statLabel}>COMPRAS</Text>
            </View>
          </FadeIn>

          {/* Hucha de referidos: % acumulado por traer amigos, para gastar en
              el negocio donde te diste de alta. */}
          {!!wallet && wallet.pct > 0 && (
            <FadeIn replayOnFocus delay={stagger(1)}>
              <View style={styles.wallet}>
                <Text style={styles.walletPct}>{wallet.pct}%</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walletTitle}>acumulado en tu hucha</Text>
                  <Text style={styles.walletSub}>
                    Lo ganas cuando los amigos que invitas se dan de alta. Se aplica en el negocio donde te diste de alta.
                    {wallet.expiresAt ? ` Caduca el ${new Date(wallet.expiresAt).toLocaleDateString("es-ES")}.` : ""}
                  </Text>
                </View>
              </View>
            </FadeIn>
          )}

          {/* Bubui Plus — suscripción del usuario (1€/mes). Solo si el admin lo
              tiene activado, o si el usuario ya es Plus (para ver su estado). */}
          {(plusEnabled || plusActive) && (
            <FadeIn replayOnFocus delay={stagger(1)}>
              <Bouncy style={styles.plus} onPress={() => nav.navigate("Plus")}>
                <Text style={styles.plusEmoji}>👑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.plusTitle}>{plusActive ? "Eres Bubui Plus" : "Hazte Bubui Plus"}</Text>
                  <Text style={styles.plusSub}>
                    {plusActive
                      ? "Disfrutas de ofertas anticipadas y regalos exclusivos."
                      : "Mejores ofertas, regalos exclusivos y prioridad por 1€/mes."}
                  </Text>
                </View>
                <Text style={styles.plusChev}>›</Text>
              </Bouncy>
            </FadeIn>
          )}

          {/* Invita a amigos — acceso destacado al programa de referidos */}
          <FadeIn replayOnFocus delay={stagger(2)}>
            <Bouncy style={styles.invite} onPress={inviteFriends}>
              <Text style={styles.inviteEmoji}>🎁</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteTitle}>Invita a tus amigos a Bubui</Text>
                <Text style={styles.inviteSub}>Compárteles tu enlace por WhatsApp.</Text>
              </View>
              <Text style={styles.inviteChev}>›</Text>
            </Bouncy>
          </FadeIn>

          {/* Enlaces agrupados */}
          <FadeIn replayOnFocus delay={stagger(3)} style={styles.menu}>
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={() => Linking.openURL(`${API_BASE}/bubui/registro`)}>
              <Text style={styles.linkIcon}>🏪</Text>
              <Text style={styles.linkText}>¿Tienes un negocio? Únete a Bubui</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={() => Linking.openURL(`${API_BASE}/bubui`)}>
              <Text style={styles.linkIcon}>ℹ️</Text>
              <Text style={styles.linkText}>Cómo funciona Bubui</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={logout}>
              <Text style={styles.linkIcon}>🚪</Text>
              <Text style={styles.linkText}>Cerrar sesión</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={confirmDelete}>
              <Text style={styles.linkIcon}>🗑️</Text>
              <Text style={[styles.linkText, { color: "#dc2626" }]}>Eliminar mi cuenta</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
          </FadeIn>

          <FadeIn replayOnFocus delay={stagger(4)}>
            <Text style={styles.legal}>Bubui · Piloto en Benalmádena · Una app de Negocio Vivo</Text>
          </FadeIn>
        </View>
      </ScrollView>
      <BottomNav active="Cuenta" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    hero: {
      alignItems: "center",
      paddingBottom: 56,
      borderBottomLeftRadius: 28,
      borderBottomRightRadius: 28
    },
    tier: {
      marginTop: 10,
      backgroundColor: "rgba(255,255,255,0.22)",
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 6
    },
    tierText: { color: "#fff", fontWeight: "800", fontSize: 12 },
    avatar: {
      height: 84,
      width: 84,
      borderRadius: 42,
      backgroundColor: c.white,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 18,
      borderWidth: 4,
      borderColor: "rgba(255,255,255,0.55)"
    },
    avatarText: { color: c.pink, fontSize: 36, fontWeight: "900" },
    name: { fontSize: 22, fontWeight: "900", color: c.onAccent, marginTop: 12 },
    sub: { fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 3 },
    body: { paddingHorizontal: 16, marginTop: -36 },
    statRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
    stat: { flex: 1, backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, paddingVertical: 16, paddingHorizontal: 14, alignItems: "center", ...shadow.card },
    statEmoji: { fontSize: 22, marginBottom: 6 },
    statValue: { fontSize: 22, fontWeight: "900", color: c.pink, letterSpacing: -0.5 },
    statLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: c.grayLight, marginTop: 3 },
    plus: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#231630", borderRadius: radius.lg, padding: 16, marginBottom: 16, ...shadow.card },
    plusEmoji: { fontSize: 26 },
    plusTitle: { fontSize: 15, fontWeight: "900", color: "#FFD56A" },
    plusSub: { fontSize: 12, color: "rgba(255,255,255,0.82)", marginTop: 2, lineHeight: 16 },
    plusChev: { fontSize: 24, color: "#FFD56A", fontWeight: "900" },
    wallet: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.pinkWash, borderRadius: radius.lg, borderWidth: 1, borderColor: c.pinkSoft, padding: 16, marginBottom: 16 },
    walletPct: { fontSize: 32, fontWeight: "900", color: c.pinkDeep, letterSpacing: -1 },
    walletTitle: { fontSize: 14, fontWeight: "900", color: c.pinkDeep },
    walletSub: { fontSize: 12, color: c.gray, marginTop: 2, lineHeight: 16 },
    invite: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.pinkWash, borderRadius: radius.lg, borderWidth: 1, borderColor: c.pinkSoft, padding: 16, marginBottom: 16 },
    inviteEmoji: { fontSize: 26 },
    inviteTitle: { fontSize: 15, fontWeight: "900", color: c.black },
    inviteSub: { fontSize: 12, color: c.gray, marginTop: 2 },
    inviteChev: { fontSize: 24, color: c.pink, fontWeight: "900" },
    menu: { backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden", ...shadow.card },
    link: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    linkIcon: { fontSize: 18 },
    linkText: { flex: 1, fontSize: 14, fontWeight: "700", color: c.black },
    chev: { fontSize: 22, color: c.grayLight },
    divider: { height: 1, backgroundColor: c.border, marginLeft: 46 },
    legal: { fontSize: 11, color: c.grayLight, textAlign: "center", marginTop: 22 }
  });
