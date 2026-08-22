import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking, Share, Platform } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE } from "../lib/api";
import { BusinessIcon } from "../components/BusinessIcon";
import { businessContactLinks, businessDiscountCopy, couponExpiryCopy, resolveBusinessHero } from "../lib/business-detail-presentation";
import { FadeIn } from "../components/FadeIn";
import { Gradient } from "../components/Gradient";
import { useTheme, type Palette, radius, shadow, gradients } from "../lib/theme";
import type { RootStackParamList } from "../../App";

/** Negocio mostrado en el detalle. Reúne los campos que devuelven los
 *  endpoints de offers (cupón activo) y discover (red completa); todos
 *  salvo los básicos son opcionales según el origen. */
export type BusinessLite = {
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
  coverImageUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  brandColor?: string | null;
  defaultDiscountPct?: number;
  discountPct?: number;
  distanceM?: number | null;
  topInCategory?: boolean;
  hoursLeft?: number;
  rewardLabel?: string | null;
  // Promoción interna (banner del Home con info propia, sin comercio real).
  description?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  isPromo?: boolean;
};

export type NegocioParam = { business: BusinessLite };

type NegocioRoute = RouteProp<RootStackParamList, "Negocio">;

function fmtDistance(m: number | null | undefined): string | null {
  if (m == null) return null;
  return m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function Negocio() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  const { business: b } = useRoute<NegocioRoute>().params;

  const discount = b.discountPct ?? b.defaultDiscountPct;
  const discountCopy = businessDiscountCopy(discount);
  const expiryCopy = couponExpiryCopy(b.hoursLeft);
  const media = resolveBusinessHero(b);
  const contactLinks = businessContactLinks({ websiteUrl: b.websiteUrl, instagramUrl: b.instagramUrl, facebookUrl: b.facebookUrl, tiktokUrl: b.tiktokUrl, whatsapp: b.phone });
  const distance = fmtDistance(b.distanceM);
  // Para promos internas no hay ficha web: usamos su enlace de CTA o la home.
  const webUrl = b.slug ? `${API_BASE}/bubui/n/${b.slug}` : b.ctaLink || API_BASE;

  // Abre la app de mapas en MODO NAVEGACIÓN (turn-by-turn). En Android,
  // `google.navigation:` arranca la guía por voz directamente; en iOS, Apple
  // Maps con `daddr` + `dirflg=d` muestra la ruta lista para iniciar.
  function howToGet() {
    const dest =
      b.latitude != null && b.longitude != null
        ? `${b.latitude},${b.longitude}`
        : encodeURIComponent([b.address, b.city, b.name].filter(Boolean).join(", "));
    const url = Platform.OS === "ios" ? `http://maps.apple.com/?daddr=${dest}&dirflg=d` : `google.navigation:q=${dest}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(b.name)}`).catch(() => {})
    );
  }

  // Llamada directa al teléfono público del negocio.
  function callBusiness() {
    if (!b.phone) return;
    Linking.openURL(`tel:${b.phone.replace(/\s+/g, "")}`).catch(() => {});
  }

  // Comparte el descuento por WhatsApp; si no está instalado, abre la hoja de
  // compartir del sistema (así funciona para todos).
  async function shareDiscount() {
    const pct = discount ? `-${discount}%` : "un descuentazo";
    const msg = `🎉 ${pct} en ${b.name} con Bubui. ¡Mira! ${webUrl}`;
    // openURL directo: en iOS abre WhatsApp si está instalado y lanza si no;
    // en Android evita los problemas de visibilidad de paquetes de canOpenURL.
    try {
      await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`);
      return;
    } catch {}
    try {
      await Share.share({ message: msg, url: webUrl });
    } catch {}
  }

  async function share() {
    const pct = discount ? ` Tienen hasta -${discount}% con Bubui.` : "";
    try {
      await Share.share({
        message: `Mira ${b.name} en Bubui.${pct} ${webUrl}`,
        url: webUrl // iOS usa este campo aparte
      });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <FadeIn replayOnFocus dy={0} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Portada y logo son recursos distintos. */}
        <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
          {media.heroUrl ? (
            <Image source={{ uri: media.heroUrl }} style={styles.heroImage} resizeMode="cover" />
          ) : b.brandColor ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: b.brandColor }]} />
          ) : (
            <Gradient colors={gradients.brand} style={StyleSheet.absoluteFill} />
          )}
          <TouchableOpacity style={styles.closeBtn} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Feed"))} hitSlop={8}>
            <Text style={styles.closeText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={share} hitSlop={8}>
            <Text style={styles.shareIcon}>↗</Text>
          </TouchableOpacity>

          {media.logoUrl ? (
            <Image source={{ uri: media.logoUrl }} style={styles.logo} resizeMode="contain" />
          ) : (
            <View style={styles.logoFallback}><Text style={styles.logoInitial}>{b.name.trim()[0]?.toUpperCase() || "B"}</Text></View>
          )}
          {discountCopy && (
            <View style={styles.tag}><Text style={styles.tagText}>{discountCopy.badge}</Text></View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{b.name}</Text>
          <Text style={styles.meta}>
            {b.category}
            {b.city ? ` · ${b.city}` : ""}
            {distance ? ` · ${distance}` : ""}
          </Text>

          {b.topInCategory && (
            <View style={styles.badge}><Text style={styles.badgeText}>🏆 Top en su categoría</Text></View>
          )}

          {!!b.rewardLabel && <Text style={styles.reward}>🎁 {b.rewardLabel}</Text>}

          {discountCopy && (
            <View style={styles.discountCard}>
              <Text style={styles.discountBadge}>{discountCopy.badge}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.discountTitle}>{discountCopy.title}</Text>
                <Text style={styles.discountDetail}>{discountCopy.detail}</Text>
              </View>
            </View>
          )}

          {!!b.description && <Text style={styles.desc}>{b.description}</Text>}

          {!!b.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>📍</Text>
              <Text style={styles.infoText}>{b.address}</Text>
            </View>
          )}

          {expiryCopy && (
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>⏰</Text>
              <Text style={[styles.infoText, (b.hoursLeft ?? Infinity) < 24 && { color: c.pink, fontWeight: "800" }]}>
                {expiryCopy}
              </Text>
            </View>
          )}

          {/* CTA principal: promo interna abre su enlace; un comercio invita a
              escanear su QR en el local. */}
          {b.isPromo ? (
            b.ctaLink ? (
              <TouchableOpacity style={styles.ctaWrap} onPress={() => Linking.openURL(b.ctaLink!).catch(() => {})} activeOpacity={0.9}>
                <Gradient colors={gradients.hero} style={styles.cta}>
                  <Text style={styles.ctaText}>{b.ctaLabel || "Ver más"}</Text>
                </Gradient>
              </TouchableOpacity>
            ) : null
          ) : (
            <TouchableOpacity style={styles.ctaWrap} onPress={() => nav.navigate("Scan", { businessId: "" })} activeOpacity={0.9}>
              <Gradient colors={gradients.hero} style={styles.cta}>
                <BusinessIcon name="scan" size={20} color="#fff" />
                <Text style={styles.ctaText}>Escanear QR aquí</Text>
              </Gradient>
            </TouchableOpacity>
          )}

          <View style={styles.actionsRow}>
            {!b.isPromo && (
              <TouchableOpacity style={styles.action} onPress={howToGet} activeOpacity={0.85}>
                <BusinessIcon name="navigate" size={22} color={c.pink} />
                <Text style={styles.actionText}>Cómo llegar</Text>
              </TouchableOpacity>
            )}
            {!!b.phone && (
              <TouchableOpacity style={styles.action} onPress={callBusiness} activeOpacity={0.85}>
                <BusinessIcon name="call" size={22} color={c.pink} />
                <Text style={styles.actionText}>Llamar</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.action} onPress={shareDiscount} activeOpacity={0.85}>
              <BusinessIcon name="share" size={22} color={c.pink} />
              <Text style={styles.actionText}>Compartir</Text>
            </TouchableOpacity>
          </View>

          {contactLinks.length > 0 && (
            <View style={styles.socialSection}>
              <Text style={styles.socialTitle}>Conecta con {b.name}</Text>
              <View style={styles.socialGrid}>
                {contactLinks.map((link) => (
                  <TouchableOpacity key={link.kind} style={styles.socialAction} onPress={() => Linking.openURL(link.url).catch(() => {})} activeOpacity={0.82}>
                    <BusinessIcon name={link.kind} size={22} color={c.pink} />
                    <Text style={styles.socialText}>{link.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {!b.isPromo && !!b.slug && (
            <TouchableOpacity onPress={() => Linking.openURL(webUrl).catch(() => {})} style={{ marginTop: 14 }}>
              <Text style={styles.fichaLink}>Ver ficha completa ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      </FadeIn>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    hero: { height: 240, alignItems: "center", justifyContent: "flex-end", paddingBottom: 0, overflow: "hidden" },
    heroImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
    closeBtn: { position: "absolute", left: 14, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
    closeText: { fontSize: 26, fontWeight: "900", color: "#0A0A0A", marginTop: -2 },
    shareBtn: { position: "absolute", right: 14, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
    shareIcon: { fontSize: 20, fontWeight: "900", color: "#0A0A0A" },
    logo: { height: 110, width: 110, borderRadius: 24, marginBottom: -34, borderWidth: 4, borderColor: c.bg, backgroundColor: c.white, ...shadow.card },
    logoFallback: { height: 110, width: 110, borderRadius: 24, marginBottom: -34, borderWidth: 4, borderColor: c.bg, backgroundColor: c.pinkWash, alignItems: "center", justifyContent: "center", ...shadow.card },
    logoInitial: { fontSize: 42, fontWeight: "900", color: c.pinkDeep },
    tag: { position: "absolute", right: 16, bottom: 14, backgroundColor: c.pink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, ...shadow.btn },
    tagText: { color: c.onAccent, fontWeight: "900", fontSize: 15 },
    body: { paddingHorizontal: 20, paddingTop: 46, alignItems: "center" },
    name: { fontSize: 24, fontWeight: "900", color: c.black, textAlign: "center", letterSpacing: -0.5 },
    meta: { fontSize: 14, color: c.gray, marginTop: 4, textAlign: "center" },
    badge: { marginTop: 12, backgroundColor: c.pinkWash, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: c.pinkSoft },
    badgeText: { color: c.pinkDeep, fontWeight: "800", fontSize: 13 },
    reward: { marginTop: 12, fontSize: 15, fontWeight: "700", color: c.ink, textAlign: "center" },
    discountCard: { alignSelf: "stretch", marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.pinkWash, borderWidth: 1, borderColor: c.pinkSoft, borderRadius: radius.lg, padding: 14 },
    discountBadge: { minWidth: 64, textAlign: "center", color: c.onAccent, backgroundColor: c.pink, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 9, fontSize: 18, fontWeight: "900", overflow: "hidden" },
    discountTitle: { color: c.black, fontSize: 15, fontWeight: "900" },
    discountDetail: { color: c.gray, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
    desc: { marginTop: 14, fontSize: 14.5, color: c.ink, lineHeight: 21, textAlign: "center" },
    infoRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch", marginTop: 14, paddingHorizontal: 4 },
    infoIcon: { fontSize: 16 },
    infoText: { flex: 1, fontSize: 14, color: c.ink, lineHeight: 20 },
    ctaWrap: { alignSelf: "stretch", marginTop: 26, borderRadius: radius.pill, ...shadow.btn },
    cta: { flexDirection: "row", gap: 8, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
    ctaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
    actionsRow: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 14 },
    action: { flex: 1, paddingVertical: 14, alignItems: "center", gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.white, ...shadow.card },
    actionText: { fontSize: 12.5, fontWeight: "800", color: c.ink },
    socialSection: { alignSelf: "stretch", marginTop: 22 },
    socialTitle: { color: c.black, fontSize: 16, fontWeight: "900", marginBottom: 10 },
    socialGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    socialAction: { minWidth: "30%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.white },
    socialText: { color: c.ink, fontSize: 12.5, fontWeight: "800" },
    fichaLink: { fontSize: 13, fontWeight: "700", color: c.gray, textAlign: "center" }
  });
