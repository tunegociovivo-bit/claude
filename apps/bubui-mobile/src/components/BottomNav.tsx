import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type Palette, shadow, gradients } from "../lib/theme";
import { Gradient } from "./Gradient";
import { Bouncy } from "./Bouncy";
import { sfx } from "../lib/sound";
import { api } from "../lib/api";
import { NavIcon, type NavIconName } from "./NavIcons";

// Iconos vectoriales (Ionicons): nítidos y coherentes con la marca. Cada tab
// define su variante "outline" (inactivo) y rellena (activo).
// `gate` indica de qué flag de sección depende la pestaña (Descubre/Mapa).
type SectionGate = "discover" | "mapa";
const TABS: { route: string; label: string; icon: NavIconName; gate?: SectionGate }[] = [
  { route: "Feed", label: "Inicio", icon: "home" },
  { route: "Descubre", label: "Descubre", icon: "compass", gate: "discover" },
  { route: "Mapa", label: "Mapa", icon: "map", gate: "mapa" },
  { route: "Cuenta", label: "Cuenta", icon: "person" }
];

// Mínimo de comercios para mostrar Descubre/Mapa (fallback si el servidor no
// devuelve los flags `sections`, p. ej. versión antigua del backend).
const MIN_BUSINESSES = 10;
type Sections = { discover: boolean; mapa: boolean };
// Caché con TTL corto: el valor cacheado evita el "salto" de pestañas al
// cambiar de pantalla, pero se refresca para que los cambios del admin
// (forzar Descubre/Mapa) lleguen sin tener que matar la app.
const SECTIONS_TTL_MS = 60_000;
let cachedSections: Sections | null = null;
let cachedAt = 0;

export function BottomNav({ active }: { active: string }) {
  const nav = useNavigation<any>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [sections, setSections] = useState<Sections>(cachedSections ?? { discover: false, mapa: false });

  useEffect(() => {
    if (cachedSections !== null && Date.now() - cachedAt < SECTIONS_TTL_MS) return;
    let alive = true;
    api
      .stats()
      .then((s) => {
        // Backend nuevo: usa los flags resueltos (umbral u override admin).
        // Backend antiguo: cae al umbral de comercios.
        const fallback = (s?.businesses ?? 0) >= MIN_BUSINESSES;
        cachedSections = s?.sections ?? { discover: fallback, mapa: fallback };
        cachedAt = Date.now();
        if (alive) setSections(cachedSections);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const tabs = TABS.filter((t) => !t.gate || sections[t.gate]);
  // Repartimos las pestañas a ambos lados del FAB central (Escanear). Con los
  // dos lados a flex:1 el hueco central —y por tanto el FAB— queda centrado
  // sea cual sea el número de pestañas activas.
  const half = Math.ceil(tabs.length / 2);
  const left = tabs.slice(0, half);
  const right = tabs.slice(half);

  const renderTab = (t: (typeof TABS)[number]) => {
    const on = t.route === active;
    return (
      <TouchableOpacity
        key={t.route}
        style={styles.item}
        onPress={() => { if (!on) nav.navigate(t.route); }}
        activeOpacity={0.7}
      >
        <NavIcon name={t.icon} size={23} color={on ? c.pink : c.grayLight} filled={on} />
        <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        <View style={styles.side}>{left.map(renderTab)}</View>
        <View style={styles.fabGap} />
        <View style={styles.side}>{right.map(renderTab)}</View>
      </View>

      {/* FAB central: la acción estrella (escanear) siempre a un toque. */}
      <View style={styles.fabHolder} pointerEvents="box-none">
        <Bouncy
          scaleTo={0.9}
          style={styles.fab}
          onPress={() => { sfx.tap(); nav.navigate("Scan", { businessId: "" }); }}
        >
          <Gradient colors={gradients.pink} style={styles.fabInner}>
            <NavIcon name="scan" size={28} color="#fff" />
          </Gradient>
        </Bouncy>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.bg,
      paddingTop: 6,
      paddingHorizontal: 12
    },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.white,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 12,
      paddingHorizontal: 6,
      ...shadow.lg
    },
    side: { flex: 1, flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
    item: { alignItems: "center", gap: 4, minWidth: 48 },
    fabGap: { width: 74 },
    label: { fontSize: 10, color: c.gray, fontWeight: "600" },
    labelOn: { color: c.pink, fontWeight: "800" },
    fabHolder: {
      position: "absolute",
      top: -22,
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 10
    },
    fab: {
      width: 66,
      height: 66,
      borderRadius: 33,
      backgroundColor: c.bg,
      alignItems: "center",
      justifyContent: "center",
      ...shadow.lg
    },
    fabInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center"
    }
  });
