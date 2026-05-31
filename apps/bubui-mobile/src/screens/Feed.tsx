import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, Animated, Easing, Image, Dimensions, Linking } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { CheckSession, clearSession, type Customer } from "../lib/session";
import { api } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import { registerExpoPushForCustomer } from "../lib/push";
import { startBubuiGeofencing, stopBubuiGeofencing } from "../lib/geofence";

type Offer = {
  offerId: string;
  business: {
    id: string;
    slug: string;
    name: string;
    category: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    logoUrl?: string | null;
    brandColor?: string | null;
  };
  discountPct: number;
  rewardLabel?: string | null;
  hoursLeft: number;
  distanceM: number | null;
};

// Banner cuadrado, centrado y acotado: nunca a pantalla completa ni recortado.
const PROMO_SIZE = Math.min(Dimensions.get("window").width - 64, 300);

export function Feed() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ imageUrl?: string; link?: string; active: boolean } | null>(null);

  useEffect(() => {
    try {
      api.banner().then(setBanner).catch(() => {});
    } catch {}
  }, []);

  // Animación de atención del botón Escanear: pulso de escala continuo.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const c = await CheckSession();
      if (!c) {
        nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
        return;
      }
      setCustomer(c);
      // Registramos el token de push en background — no bloquea la carga.
      registerExpoPushForCustomer(c.customerId).catch(() => {});
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      } catch {}
      try {
        const r = await api.offers(c.customerId, lat, lng);
        const items: Offer[] = r.items ?? [];
        setOffers(items);
        // Geocercas alrededor de los negocios con cupón activo (background).
        startBubuiGeofencing(
          items.map((o) => ({
            id: o.business.id,
            name: o.business.name,
            latitude: o.business.latitude,
            longitude: o.business.longitude,
            discountPct: o.discountPct
          }))
        ).catch(() => {});
      } catch {
        setOffers([]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [nav]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function logout() {
    await clearSession();
    stopBubuiGeofencing().catch(() => {});
    nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
  }

  const header = (
    <View>
      <View style={styles.header}>
        <Wordmark size={26} />
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Has ahorrado + cupón */}
      <View style={styles.savedCard}>
        <View>
          <Text style={styles.savedLabel}>HAS AHORRADO</Text>
          <Text style={styles.savedAmount}>{(customer?.totalSaved ?? 0).toFixed(2)} €</Text>
        </View>
        <Text style={{ fontSize: 38 }}>🎟️</Text>
      </View>

      {/* Botón escanear con animación */}
      <Animated.View style={{ transform: [{ scale }], marginBottom: 20 }}>
        <TouchableOpacity style={styles.cta} onPress={() => nav.navigate("Scan", { businessId: "" })} activeOpacity={0.9}>
          <Text style={styles.ctaText}>⛶  Escanear QR de un negocio</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Banner promocional: remoto (gestionado desde admin) o tarjeta por defecto */}
      {banner?.active && banner.imageUrl ? (
        <TouchableOpacity
          activeOpacity={banner.link ? 0.85 : 1}
          onPress={() => { if (banner.link) Linking.openURL(banner.link).catch(() => {}); }}
        >
          <Image source={{ uri: banner.imageUrl }} style={styles.promo} resizeMode="contain" />
        </TouchableOpacity>
      ) : (
        <View style={styles.promoCard}>
          <Image source={require("../../assets/ill-cupon.png")} style={styles.promoIll} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.promoTitle}>Cuanto más compras local, más ahorras</Text>
            <Text style={styles.promoSub}>Escanea en cada negocio y desbloquea nuevos cupones cerca de ti.</Text>
          </View>
        </View>
      )}

      <Text style={styles.section}>Tus cupones activos ({offers.length})</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={c.pink} />}
        data={offers}
        keyExtractor={(o) => o.offerId}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Image source={require("../../assets/ill-ruta.png")} style={styles.emptyIll} resizeMode="contain" />
            <Text style={styles.emptyTitle}>Aún no tienes cupones</Text>
            <Text style={styles.emptyText}>Escanea el QR de un negocio Bubui y empieza a ahorrar en tu barrio.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() =>
              nav.navigate("Negocio", {
                business: { ...item.business, discountPct: item.discountPct, hoursLeft: item.hoursLeft, distanceM: item.distanceM, rewardLabel: item.rewardLabel }
              })
            }
          >
            <View style={[styles.photo, item.business.brandColor ? { backgroundColor: item.business.brandColor } : null]}>
              {!!item.business.logoUrl && (
                <Image source={{ uri: item.business.logoUrl }} style={styles.photoImg} resizeMode="cover" />
              )}
              <View style={styles.tag}><Text style={styles.tagText}>-{item.discountPct}%</Text></View>
            </View>
            <View style={styles.cardBody}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bizName} numberOfLines={1}>{item.business.name}</Text>
                <Text style={styles.bizCat} numberOfLines={1}>
                  {item.business.category}
                  {item.distanceM != null && ` · ${item.distanceM > 1000 ? `${(item.distanceM / 1000).toFixed(1)} km` : `${item.distanceM} m`}`}
                </Text>
              </View>
              <Text style={[styles.exp, item.hoursLeft < 24 && styles.expUrgent]}>⏰ {item.hoursLeft}h</Text>
            </View>
          </TouchableOpacity>
        )}
      />
      <BottomNav active="Feed" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    logout: { fontSize: 13, color: c.gray, fontWeight: "600" },
    savedCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.white, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: 18, marginBottom: 16, ...shadow.card },
    savedLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.grayLight },
    savedAmount: { fontSize: 36, fontWeight: "900", color: c.pink, letterSpacing: -1 },
    cta: { backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
    ctaText: { color: c.onAccent, fontSize: 16, fontWeight: "800" },
    promo: { width: PROMO_SIZE, height: PROMO_SIZE, alignSelf: "center", marginBottom: 22, borderRadius: radius.xl },
    promoCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.pinkWash, borderRadius: radius.xl, borderWidth: 1, borderColor: c.pinkSoft, padding: 14, marginBottom: 22 },
    promoIll: { width: 76, height: 76 },
    promoTitle: { fontSize: 15, fontWeight: "900", color: c.black, letterSpacing: -0.3 },
    promoSub: { fontSize: 12, color: c.gray, marginTop: 3, lineHeight: 16 },
    section: { fontSize: 12, fontWeight: "800", color: c.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    card: { backgroundColor: c.white, borderRadius: radius.lg, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: c.border, ...shadow.card },
    photo: { height: 130, backgroundColor: c.pinkSoft, justifyContent: "flex-start", alignItems: "flex-end" },
    photoImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    tag: { margin: 12, backgroundColor: c.pink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    tagText: { color: c.onAccent, fontWeight: "900", fontSize: 13 },
    cardBody: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
    bizName: { fontWeight: "800", color: c.black, fontSize: 15 },
    bizCat: { color: c.gray, fontSize: 12, marginTop: 2 },
    exp: { fontSize: 12, color: c.gray, fontWeight: "700" },
    expUrgent: { color: c.pink },
    emptyWrap: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
    emptyIll: { width: 220, height: 179, marginBottom: 6 },
    emptyTitle: { fontSize: 17, fontWeight: "900", color: c.black, marginBottom: 4 },
    emptyText: { fontSize: 14, color: c.gray, textAlign: "center", lineHeight: 20 }
  });
