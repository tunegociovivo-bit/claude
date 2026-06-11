import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, Animated, Easing, Image, Dimensions, Linking, AppState } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { getCurrentLatLng } from "../lib/location";
import { CheckSession, saveSession, type Customer } from "../lib/session";
import { api } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { Bouncy } from "../components/Bouncy";
import { CountUp } from "../components/CountUp";
import { sfx } from "../lib/sound";
import { stagger } from "../lib/anim";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import { registerExpoPushForCustomer } from "../lib/push";
import { startBubuiGeofencing } from "../lib/geofence";

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

const SCREEN_W = Dimensions.get("window").width;
// Banner a ancho completo (edge-to-edge): cancela el padding lateral (16) del
// FlatList con un margen negativo. La ALTURA se calcula con la proporción real
// de la imagen (Image.getSize) para mostrarla COMPLETA, sin recortar. Mientras
// se mide, se usa un alto provisional ~2:1.
const BANNER_W = SCREEN_W;
const BANNER_H_FALLBACK = Math.round(SCREEN_W * 0.52);

export function Feed() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Invitado = sin sesión. Entra desde el onboarding ("explorar sin cuenta").
  const [guest, setGuest] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ imageUrl?: string; link?: string; active: boolean } | null>(null);
  // Alto real del banner según la proporción de la imagen (para no recortarla).
  const [bannerH, setBannerH] = useState<number>(BANNER_H_FALLBACK);
  useEffect(() => {
    const uri = banner?.active ? banner.imageUrl : undefined;
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => { if (w > 0) setBannerH(Math.round((BANNER_W * h) / w)); },
      () => setBannerH(BANNER_H_FALLBACK)
    );
  }, [banner?.imageUrl, banner?.active]);

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
      setCustomer(c);
      setGuest(!c);
      if (c) {
        // Stats vivas: el "Has ahorrado" de la sesión local se queda obsoleto
        // en cuanto el negocio confirma una compra. Refresco en segundo plano
        // (pinta el valor cacheado al instante y lo actualiza al llegar).
        api
          .customerSummary(c.customerId)
          .then(async (s) => {
            const updated = { ...c, name: s.name ?? c.name, totalSaved: s.totalSaved, totalPurchases: s.totalPurchases };
            setCustomer(updated);
            await saveSession(updated).catch(() => {});
          })
          .catch(() => {});
      }
      // Banner gestionable desde admin: se refresca en cada foco / pull-to-refresh.
      api.banner().then(setBanner).catch(() => {});
      // Permiso pedido como máximo una vez por sesión (ver lib/location.ts:
      // pedirlo en cada load provocaba un bucle de diálogos en MIUI y dejaba
      // colgada la petición de cámara de Scan).
      const { lat, lng } = await getCurrentLatLng();
      if (c) {
        // Usuario registrado: sus cupones personalizados + push + geocercas.
        registerExpoPushForCustomer(c.customerId).catch(() => {});
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
      } else {
        // Invitado (sin cuenta): solo contenido público — catálogo de negocios
        // (los destacados por el admin van primero) + banner. Sin ofertas
        // personalizadas, push ni geocercas. Para escanear/canjear hay que
        // registrarse (las pantallas Scan/Cuenta/Afiliados ya lo exigen).
        try {
          const r = await api.discover(lat, lng);
          const items: Offer[] = (r.items ?? []).map((b: any) => ({
            offerId: b.id,
            business: {
              id: b.id, slug: b.slug, name: b.name, category: b.category, city: b.city,
              latitude: b.latitude, longitude: b.longitude, logoUrl: b.logoUrl, brandColor: b.brandColor
            },
            discountPct: b.defaultDiscountPct ?? 0,
            rewardLabel: null,
            hoursLeft: 0,
            distanceM: b.distanceM ?? null
          }));
          setOffers(items);
        } catch {
          setOffers([]);
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [nav]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresca al volver de segundo plano (desbloquear el móvil / volver a la
  // app): useFocusEffect NO se dispara en ese caso, así que sin esto la
  // ubicación se quedaría congelada mientras el usuario está fuera con la app
  // abierta. (Con la app CERRADA no se puede actualizar: quitamos la ubicación
  // en segundo plano para cumplir con Google Play.)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      // Solo si el Feed está enfocado: este listener sigue vivo con el Feed
      // montado debajo de otras pantallas (p. ej. Scan) y recargar ahí compite
      // con ellas (además del bucle con los diálogos de permisos).
      if (s === "active" && nav.isFocused()) load();
    });
    return () => sub.remove();
  }, [load, nav]);

  const header = (
    <View>
      <FadeIn replayOnFocus style={styles.header}>
        <Wordmark size={26} />
      </FadeIn>

      {guest ? (
        /* Invitado: tarjeta de registro en lugar de stats + escanear. */
        <FadeIn replayOnFocus delay={stagger(1)}>
          <View style={styles.guestCard}>
            <Text style={styles.guestTitle}>Estás explorando como invitado</Text>
            <Text style={styles.guestText}>
              Crea tu cuenta gratis para escanear, canjear ofertas y ganar premios en tu barrio.
            </Text>
            <Bouncy style={styles.guestCta} onPress={() => { sfx.tap(); nav.navigate("Onboarding"); }}>
              <Text style={styles.guestCtaText}>Crear cuenta gratis</Text>
            </Bouncy>
          </View>
        </FadeIn>
      ) : (
        <>
          {/* Has ahorrado + cupón */}
          <FadeIn replayOnFocus delay={stagger(1)} style={styles.savedCard}>
            <View>
              <Text style={styles.savedLabel}>HAS AHORRADO</Text>
              <CountUp value={customer?.totalSaved ?? 0} decimals={2} suffix=" €" style={styles.savedAmount} />
            </View>
            <Text style={{ fontSize: 38 }}>🎟️</Text>
          </FadeIn>

          {/* Botón escanear con animación (pulso + rebote al pulsar) */}
          <FadeIn replayOnFocus delay={stagger(2)}>
            <Animated.View style={{ transform: [{ scale }], marginBottom: 20 }}>
              <Bouncy style={styles.cta} onPress={() => { sfx.tap(); nav.navigate("Scan", { businessId: "" }); }}>
                <Text style={styles.ctaText}>⛶  Escanear QR de un negocio</Text>
              </Bouncy>
            </Animated.View>
          </FadeIn>
        </>
      )}

      {/* Banner promocional: remoto (gestionado desde admin) o tarjeta por defecto */}
      <FadeIn replayOnFocus delay={stagger(3)}>
        {banner?.active && banner.imageUrl ? (
          <TouchableOpacity
            style={styles.promoWrap}
            activeOpacity={banner.link ? 0.9 : 1}
            onPress={() => { if (banner.link) Linking.openURL(banner.link!).catch(() => {}); }}
          >
            <Image
              source={{ uri: banner.imageUrl }}
              style={[styles.promo, { height: bannerH }]}
              resizeMode="cover"
              onError={() => setBanner((b) => (b ? { ...b, active: false } : b))}
            />
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
      </FadeIn>

      <FadeIn replayOnFocus delay={stagger(4)}>
        <Text style={styles.section}>{guest ? "Negocios y ofertas cerca de ti" : `Tus cupones activos (${offers.length})`}</Text>
      </FadeIn>
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
            <Text style={styles.emptyTitle}>{guest ? "Aún no hay negocios cerca" : "Aún no tienes cupones"}</Text>
            <Text style={styles.emptyText}>
              {guest
                ? "Prueba a moverte por el mapa o vuelve más tarde: la red crece cada semana."
                : "Escanea el QR de un negocio Bubui y empieza a ahorrar en tu barrio."}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 6) * 50} dy={18}>
            <Bouncy
              style={styles.card}
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
                {item.hoursLeft > 0 && (
                  <Text style={[styles.exp, item.hoursLeft < 24 && styles.expUrgent]}>⏰ {item.hoursLeft}h</Text>
                )}
              </View>
            </Bouncy>
          </FadeIn>
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
    savedCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.white, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: 18, marginBottom: 16, ...shadow.card },
    guestCard: { backgroundColor: c.white, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: 18, marginBottom: 20, ...shadow.card },
    guestTitle: { fontSize: 16, fontWeight: "800", color: c.black, marginBottom: 4 },
    guestText: { fontSize: 13, color: c.grayLight, lineHeight: 19, marginBottom: 14 },
    guestCta: { backgroundColor: c.pink, borderRadius: radius.lg, paddingVertical: 13, alignItems: "center" },
    guestCtaText: { color: c.white, fontWeight: "800", fontSize: 15 },
    savedLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.grayLight },
    savedAmount: { fontSize: 36, fontWeight: "900", color: c.pink, letterSpacing: -1 },
    cta: { backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
    ctaText: { color: c.onAccent, fontSize: 16, fontWeight: "800" },
    // Wrapper a ancho completo: -16 de margen a cada lado para cancelar el
    // padding del FlatList, sombra para que el banner resalte sobre el fondo.
    promoWrap: { width: BANNER_W, marginLeft: -16, marginBottom: 22, ...shadow.card },
    // height se fija dinámicamente (bannerH) según la proporción de la imagen.
    promo: { width: BANNER_W },
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
