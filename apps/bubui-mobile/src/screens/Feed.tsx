import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, Animated, Easing, Image, Dimensions, Linking, AppState } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { getCurrentLatLng } from "../lib/location";
import { CheckSession, saveSession, type Customer } from "../lib/session";
import { api, type BannerBusiness } from "../lib/api";
import { shareReferralForOffer } from "../lib/share-referral";
import { Ionicons } from "@expo/vector-icons";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { Bouncy } from "../components/Bouncy";
import { CountUp } from "../components/CountUp";
import { Gradient } from "../components/Gradient";
import { sfx } from "../lib/sound";
import { stagger } from "../lib/anim";
import { useTheme, type Palette, radius, shadow, gradients } from "../lib/theme";
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
    address?: string | null;
    phone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    logoUrl?: string | null;
    brandColor?: string | null;
  };
  discountPct: number;
  rewardLabel?: string | null;
  hoursLeft: number;
  distanceM: number | null;
  // Oferta-reto viral: bloqueada hasta traer amigos.
  locked?: boolean;
  friendsNeeded?: number;
  sharesLeft?: number;
  friendsJoined?: string[]; // iniciales de los amigos que ya cuentan
};

const SCREEN_W = Dimensions.get("window").width;
// Banner a ancho completo (edge-to-edge): cancela el padding lateral (16) del
// FlatList con un margen negativo. La ALTURA se calcula con la proporción real
// de la imagen (Image.getSize) para mostrarla COMPLETA, sin recortar. Mientras
// se mide, se usa un alto provisional ~2:1.
const BANNER_W = SCREEN_W;
const BANNER_H_FALLBACK = Math.round(SCREEN_W * 0.52);

// Gradientes de cabecera para las tarjetas de oferta sin logo: dan variedad
// y color sin depender de la foto del negocio.
const OFFER_GRADS: string[][] = [
  ["#FF8A5B", "#FF2E88"],
  ["#7C3AED", "#FF2E88"],
  ["#22D3A6", "#0EA5E9"],
  ["#FF3D9A", "#FF6B5E"]
];

function fmtDist(m: number | null | undefined): string | null {
  if (m == null) return null;
  return m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function Feed() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Invitado = sin sesión. Entra desde el onboarding ("explorar sin cuenta").
  const [guest, setGuest] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Aviso de fallo de red (la carga del catálogo/ofertas no respondió).
  const [netError, setNetError] = useState(false);
  const [banner, setBanner] = useState<{ imageUrl?: string; link?: string; active: boolean; business?: BannerBusiness } | null>(null);
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
          setNetError(false);
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
          // No borramos lo ya cargado: mostramos aviso de red y dejamos reintentar.
          setNetError(true);
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
              address: b.address, phone: b.phone,
              latitude: b.latitude, longitude: b.longitude, logoUrl: b.logoUrl, brandColor: b.brandColor
            },
            discountPct: b.defaultDiscountPct ?? 0,
            rewardLabel: null,
            hoursLeft: 0,
            distanceM: b.distanceM ?? null
          }));
          setOffers(items);
          setNetError(false);
        } catch {
          setNetError(true);
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

      {netError && (
        <TouchableOpacity style={styles.netError} onPress={load} activeOpacity={0.85}>
          <Text style={styles.netErrorText}>
            Sin conexión o el servidor no responde. Toca para reintentar.
          </Text>
        </TouchableOpacity>
      )}

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
        /* Hero: ahorro acumulado + acción de escanear, en una tarjeta con
           gradiente de marca (profundidad y energía). */
        <FadeIn replayOnFocus delay={stagger(1)}>
          <Gradient colors={gradients.brand} style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>HAS AHORRADO</Text>
                <CountUp value={customer?.totalSaved ?? 0} decimals={2} suffix=" €" style={styles.heroAmount} />
                <Text style={styles.heroSub}>
                  en {customer?.totalPurchases ?? 0} compra{(customer?.totalPurchases ?? 0) === 1 ? "" : "s"} con Bubui
                </Text>
              </View>
              <Text style={styles.heroEmoji}>🎟️</Text>
            </View>
            <Animated.View style={{ transform: [{ scale }] }}>
              <Bouncy style={styles.heroBtn} onPress={() => { sfx.tap(); nav.navigate("Scan", { businessId: "" }); }}>
                <Ionicons name="scan-outline" size={18} color={c.pink} />
                <Text style={styles.heroBtnText}>Escanear QR de un negocio</Text>
              </Bouncy>
            </Animated.View>
          </Gradient>
        </FadeIn>
      )}

      {/* Banner promocional: remoto (gestionado desde admin) o tarjeta por defecto */}
      <FadeIn replayOnFocus delay={stagger(3)}>
        {banner?.active && banner.imageUrl ? (
          <TouchableOpacity
            style={styles.promoWrap}
            activeOpacity={banner.business || banner.link ? 0.9 : 1}
            onPress={() => {
              // Banner que promociona un comercio o una promo interna → abre su
              // ficha (misma pantalla que una oferta). Si no, enlace externo.
              if (banner.business) { sfx.tap(); nav.navigate("Negocio", { business: banner.business }); }
              else if (banner.link) Linking.openURL(banner.link).catch(() => {});
            }}
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
          item.locked ? (
            <FadeIn delay={Math.min(index, 6) * 50} dy={18}>
              <View style={styles.challengeCard}>
                <View style={styles.challengeTop}>
                  <Text style={styles.challengeLock}>🔒</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.challengeBiz} numberOfLines={1}>{item.business.name}</Text>
                    <Text style={styles.challengeReward}>
                      {item.rewardLabel ? item.rewardLabel : `${item.discountPct}% de descuento`} · oferta especial
                    </Text>
                  </View>
                </View>
                <Text style={styles.challengeMsg}>
                  {item.sharesLeft && item.sharesLeft > 0
                    ? `Tráete ${item.sharesLeft} amig${item.sharesLeft === 1 ? "o" : "os"} más a Bubui para activarla.`
                    : "¡Ya casi! Comparte para activarla."}
                </Text>
                {/* Reto visible: una carita por amigo que ya cuenta + huecos */}
                {!!item.friendsNeeded && item.friendsNeeded > 0 && (
                  <View style={styles.slotsRow}>
                    {Array.from({ length: item.friendsNeeded }).map((_, i) => {
                      const initial = item.friendsJoined?.[i];
                      const filled = !!initial;
                      return (
                        <View key={i} style={[styles.slot, filled ? styles.slotFilled : styles.slotEmpty]}>
                          <Text style={filled ? styles.slotInitial : styles.slotPlus}>
                            {filled ? initial : "+"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
                <Bouncy
                  style={styles.challengeBtn}
                  onPress={() => {
                    sfx.tap();
                    if (customer?.customerId) {
                      void shareReferralForOffer(customer.customerId, {
                        businessName: item.business.name,
                        prize: item.rewardLabel ?? `${item.discountPct}%`,
                        friendsLeft: item.sharesLeft ?? null
                      });
                    }
                  }}
                >
                  <Text style={styles.challengeBtnText}>📲 Compartir y activar</Text>
                </Bouncy>
              </View>
            </FadeIn>
          ) : (
          <FadeIn delay={Math.min(index, 6) * 50} dy={18}>
            <Bouncy
              style={styles.card}
              onPress={() =>
                nav.navigate("Negocio", {
                  business: { ...item.business, discountPct: item.discountPct, hoursLeft: item.hoursLeft, distanceM: item.distanceM, rewardLabel: item.rewardLabel }
                })
              }
            >
              <View style={styles.photo}>
                {item.business.logoUrl ? (
                  <Image source={{ uri: item.business.logoUrl }} style={styles.photoImg} resizeMode="cover" />
                ) : (
                  <Gradient
                    colors={item.business.brandColor ? [item.business.brandColor, item.business.brandColor] : OFFER_GRADS[index % OFFER_GRADS.length]}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                {/* Velo inferior para que los chips de vidrio se lean sobre
                    cualquier foto. */}
                <Gradient colors={gradients.scrim} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.photoScrim} />
                {item.discountPct > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>-{item.discountPct}%</Text></View>
                )}
                <View style={styles.pillRow}>
                  {fmtDist(item.distanceM) && (
                    <View style={styles.pill}><Text style={styles.pillText}>📍 {fmtDist(item.distanceM)}</Text></View>
                  )}
                  {item.hoursLeft > 0 && (
                    <View style={styles.pill}><Text style={styles.pillText}>⏰ {item.hoursLeft}h</Text></View>
                  )}
                </View>
              </View>
              <View style={styles.cardBody}>
                <View style={[styles.av, { backgroundColor: item.business.brandColor || c.pink }]}>
                  <Text style={styles.avText}>{(item.business.name || "?").charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bizName} numberOfLines={1}>{item.business.name}</Text>
                  <Text style={styles.bizCat} numberOfLines={1}>
                    {item.business.category}
                    {item.business.city ? ` · ${item.business.city}` : ""}
                  </Text>
                </View>
                {item.hoursLeft > 0 && item.hoursLeft < 24 && (
                  <Text style={styles.urgent}>¡Acaba hoy!</Text>
                )}
              </View>
            </Bouncy>
          </FadeIn>
          )
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
    netError: { backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: radius.md, padding: 12, marginBottom: 14 },
    netErrorText: { color: "#92400E", fontSize: 13, fontWeight: "700", textAlign: "center" },
    guestCard: { backgroundColor: c.white, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: 18, marginBottom: 20, ...shadow.card },
    guestTitle: { fontSize: 16, fontWeight: "800", color: c.black, marginBottom: 4 },
    guestText: { fontSize: 13, color: c.grayLight, lineHeight: 19, marginBottom: 14 },
    guestCta: { backgroundColor: c.pink, borderRadius: radius.lg, paddingVertical: 13, alignItems: "center" },
    guestCtaText: { color: c.white, fontWeight: "800", fontSize: 15 },
    // Hero de ahorro (gradiente de marca)
    hero: { borderRadius: radius.xl, padding: 20, marginBottom: 20, overflow: "hidden", ...shadow.lg },
    heroTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
    heroLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, color: "rgba(255,255,255,0.85)" },
    heroAmount: { fontSize: 44, fontWeight: "900", color: "#fff", letterSpacing: -1.5, marginTop: 4 },
    heroSub: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.92)", marginTop: 3 },
    heroEmoji: { fontSize: 34, marginLeft: 8 },
    heroBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: radius.pill, paddingVertical: 14 },
    heroBtnText: { color: c.pink, fontWeight: "800", fontSize: 15 },
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
    // Oferta-reto viral (bloqueada): destaca para empujar a compartir.
    challengeCard: { backgroundColor: c.pinkSoft, borderRadius: radius.lg, marginBottom: 12, borderWidth: 2, borderColor: c.pink, padding: 14, ...shadow.card },
    challengeTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    challengeLock: { fontSize: 26 },
    challengeBiz: { fontSize: 15, fontWeight: "900", color: c.black },
    challengeReward: { fontSize: 13, fontWeight: "800", color: c.pink },
    challengeMsg: { fontSize: 13, color: c.black, marginTop: 8, marginBottom: 10 },
    slotsRow: { flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" },
    slot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    slotFilled: { backgroundColor: c.pink },
    slotEmpty: { borderWidth: 2, borderColor: c.pink, borderStyle: "dashed", backgroundColor: "transparent" },
    slotInitial: { color: c.onAccent, fontSize: 15, fontWeight: "900" },
    slotPlus: { color: c.pink, fontSize: 18, fontWeight: "900" },
    challengeBtn: { backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 13, alignItems: "center", ...shadow.btn },
    challengeBtnText: { color: c.onAccent, fontSize: 15, fontWeight: "800" },
    photo: { height: 150, backgroundColor: c.pinkSoft, justifyContent: "flex-end" },
    photoImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    photoScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 90 },
    badge: { position: "absolute", top: 12, right: 12, backgroundColor: "#fff", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, ...shadow.card },
    badgeText: { color: c.pinkDeep, fontWeight: "900", fontSize: 14 },
    pillRow: { flexDirection: "row", gap: 8, padding: 12 },
    pill: { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
    pillText: { fontSize: 12, fontWeight: "700", color: c.ink },
    cardBody: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
    av: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    avText: { color: "#fff", fontWeight: "900", fontSize: 17 },
    bizName: { fontWeight: "800", color: c.black, fontSize: 15 },
    bizCat: { color: c.gray, fontSize: 12, marginTop: 2 },
    urgent: { fontSize: 12, fontWeight: "800", color: c.pink, backgroundColor: c.pinkSoft, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10 },
    emptyWrap: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
    emptyIll: { width: 220, height: 179, marginBottom: 6 },
    emptyTitle: { fontSize: 17, fontWeight: "900", color: c.black, marginBottom: 4 },
    emptyText: { fontSize: 14, color: c.gray, textAlign: "center", lineHeight: 20 }
  });
