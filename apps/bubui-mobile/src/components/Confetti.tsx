/**
 * Confeti de celebración (100% API Animated — sin librerías nativas).
 * Uso imperativo:
 *   const confetti = useRef<ConfettiHandle>(null);
 *   <Confetti ref={confetti} />
 *   confetti.current?.fire();   // p. ej. al desbloquear un premio
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

const COLORS = ["#EC4899", "#DB2777", "#F472B6", "#FBBF24", "#34D399", "#60A5FA"];
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export type ConfettiHandle = { fire: () => void };

type Piece = { x: number; key: number };

export const Confetti = forwardRef<ConfettiHandle, { count?: number }>(function Confetti({ count = 30 }, ref) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const burstRef = useRef(0);

  useImperativeHandle(ref, () => ({
    fire: () => {
      const burst = ++burstRef.current;
      const next = Array.from({ length: count }, (_, i) => ({ x: Math.random() * SCREEN_W, key: burst * 1000 + i }));
      setPieces((p) => [...p, ...next]);
      setTimeout(() => setPieces((p) => p.filter((pc) => Math.floor(pc.key / 1000) !== burst)), 2400);
    }
  }));

  if (pieces.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((pc) => (
        <ConfettiPiece key={pc.key} x={pc.x} />
      ))}
    </View>
  );
});

function ConfettiPiece({ x }: { x: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const cfg = useRef({
    driftX: (Math.random() - 0.5) * 140,
    rot: Math.random() * 360,
    size: 6 + Math.random() * 9,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 140,
    dur: 1500 + Math.random() * 600,
    round: Math.random() > 0.5
  }).current;

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: cfg.dur, delay: cfg.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t, cfg]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-40, SCREEN_H * 0.7] });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, cfg.driftX] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${cfg.rot + 540}deg`] });
  const opacity = t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: x,
        width: cfg.size,
        height: cfg.round ? cfg.size : cfg.size * 0.55,
        borderRadius: cfg.round ? cfg.size : 2,
        backgroundColor: cfg.color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }]
      }}
    />
  );
}
