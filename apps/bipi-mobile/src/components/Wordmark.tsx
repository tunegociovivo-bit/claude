import { View, Text } from "react-native";
import { colors } from "../lib/theme";

/** Wordmark "bipi" con diana (bullseye) sobre la última i, igual que la web. */
export function Wordmark({ size = 48, color = colors.black }: { size?: number; color?: string }) {
  const ring = Math.max(8, size * 0.2);
  const dot = ring * 0.34;
  const border = Math.max(1.5, ring * 0.16);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ fontSize: size, fontWeight: "900", letterSpacing: -size * 0.05, color, lineHeight: size * 1.0 }}>
        bipi
      </Text>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: border,
          borderColor: colors.pink,
          alignItems: "center",
          justifyContent: "center",
          marginLeft: size * 0.04,
          marginBottom: size * 0.12
        }}
      >
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: colors.pink }} />
      </View>
    </View>
  );
}
