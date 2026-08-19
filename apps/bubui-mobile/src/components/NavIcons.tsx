import Svg, { Path, Circle, Line } from "react-native-svg";

export type NavIconName = "home" | "compass" | "map" | "person" | "scan";

export function NavIcon({ name, size = 24, color = "#000", filled = false }: { name: NavIconName; size?: number; color?: string; filled?: boolean }) {
  const fill = filled ? color : "none";
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home": return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 10.5 12 3l9 7.5" {...common} /><Path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" {...common} fill={fill} /></Svg>;
    case "compass": return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx={12} cy={12} r={9} {...common} fill={fill} /><Path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" stroke={filled ? "#fff" : color} strokeWidth={2} strokeLinejoin="round" fill={filled ? "#fff" : "none"} /></Svg>;
    case "map": return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" {...common} fill={fill} /><Line x1={9} y1={4} x2={9} y2={18} {...common} /><Line x1={15} y1={6} x2={15} y2={20} {...common} /></Svg>;
    case "person": return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Circle cx={12} cy={8} r={4} {...common} fill={fill} /><Path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5" {...common} fill={fill} /></Svg>;
    case "scan": return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" {...common} /><Line x1={3.5} y1={12} x2={20.5} y2={12} {...common} /></Svg>;
  }
}
