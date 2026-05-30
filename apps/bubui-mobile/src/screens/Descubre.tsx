import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Image } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { colors, radius, shadow } from "../lib/theme";

type Business = {
  id: string; slug: string; name: string; category: string; city: string;
  address?: string | null; latitude?: number | null; longitude?: number | null;
  logoUrl?: string | null; brandColor?: string | null;
  defaultDiscountPct: number; distanceM: number | null; topInCategory?: boolean;
};

const CATS = [
  { key: "Todo", label: "Todos", icon: "✨" },
  { key: "Restau", label: "Restaurantes", icon: "🍴" },
  { key: "Café", label: "Cafeterías", icon: "☕" },
  { key: "Belleza", label: "Belleza", icon: "💅" },
  { key: "Tienda", label: "Tiendas", icon: "🛍" },
  { key: "Fitness", label: "Fitness", icon: "💪" }
];
const FAVS_KEY = "bubui.favs";

export function Descubre() {
  const nav = useNavigation<any>();
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("Todo");
  const [favs, setFavs] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(FAVS_KEY);
      if (raw) setFavs(JSON.parse(raw));
      let lat: number | undefined, lng: number | undefined;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude; lng = loc.coords.longitude;
        }
      } catch {}
      const r = await api.discover(lat, lng);
      setItems(r.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggleFav(slug: string) {
    const next = favs.includes(slug) ? favs.filter((s) => s !== slug) : [...favs, slug];
    setFavs(next);
    try { await AsyncStorage.setItem(FAVS_KEY, JSON.stringify(next)); } catch {}
  }

  const filtered = items.filter((b) => {
    if (cat !== "Todo" && !b.category?.toLowerCase().includes(cat.toLowerCase())) return false;
    if (query.trim() && !`${b.name} ${b.category}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const header = (
    <View>
      <View style={styles.top}>
        <Wordmark size={24} />
      </View>
      <Text style={styles.h1}>Descubre y ahorra{"\n"}cerca de ti</Text>
      <View style={styles.search}>
        <Text>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar negocios, comida, belleza…"
          placeholderTextColor={colors.grayLight}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATS}
        keyExtractor={(c) => c.key}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        style={{ marginBottom: 8 }}
        renderItem={({ item: c }) => {
          const on = cat === c.key;
          return (
            <TouchableOpacity onPress={() => setCat(c.key)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.white }]}>{c.icon} {c.label}</Text>
            </TouchableOpacity>
          );
        }}
      />
      <Text style={styles.section}>Cerca de ti</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 52, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.pink} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {items.length === 0 ? "Aún no hay negocios en tu zona. Piloto en Benalmádena." : "Sin resultados."}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: b }) => {
          const fav = favs.includes(b.slug);
          return (
            <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => nav.navigate("Negocio", { business: b })}>
              <View style={[styles.photo, b.brandColor ? { backgroundColor: b.brandColor } : null]}>
                {!!b.logoUrl && <Image source={{ uri: b.logoUrl }} style={styles.photoImg} resizeMode="cover" />}
                <TouchableOpacity style={styles.heart} onPress={() => toggleFav(b.slug)}>
                  <Text style={{ fontSize: 16 }}>{fav ? "❤️" : "🤍"}</Text>
                </TouchableOpacity>
                {b.topInCategory && <View style={styles.topBadge}><Text style={styles.topBadgeText}>🏆 Top</Text></View>}
                <View style={styles.tag}><Text style={styles.tagText}>-{b.defaultDiscountPct}%</Text></View>
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>{b.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {b.category}
                  {b.distanceM != null && ` · ${b.distanceM > 1000 ? `${(b.distanceM / 1000).toFixed(1)} km` : `${b.distanceM} m`}`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <BottomNav active="Descubre" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  top: { marginBottom: 10 },
  h1: { fontSize: 24, fontWeight: "900", color: colors.black, letterSpacing: -0.5, lineHeight: 28, marginBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10, ...shadow.card },
  searchInput: { flex: 1, fontSize: 14, color: colors.black },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.black },
  section: { fontSize: 14, fontWeight: "900", color: colors.black, marginBottom: 10, marginTop: 4 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border, ...shadow.card },
  photo: { height: 130, backgroundColor: colors.pinkSoft, justifyContent: "flex-start", alignItems: "flex-end", flexDirection: "row" },
  photoImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  heart: { position: "absolute", top: 10, left: 10, height: 34, width: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center", zIndex: 1 },
  topBadge: { position: "absolute", bottom: 10, left: 10, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  topBadgeText: { fontSize: 11, fontWeight: "800", color: colors.pinkDeep },
  tag: { margin: 12, backgroundColor: colors.pink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  tagText: { color: colors.white, fontWeight: "900", fontSize: 13 },
  body: { padding: 14 },
  name: { fontWeight: "800", color: colors.black, fontSize: 15 },
  meta: { color: colors.gray, fontSize: 12, marginTop: 2 },
  empty: { padding: 24, backgroundColor: colors.white, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1 },
  emptyText: { textAlign: "center", color: colors.gray, fontSize: 14, lineHeight: 20 }
});
