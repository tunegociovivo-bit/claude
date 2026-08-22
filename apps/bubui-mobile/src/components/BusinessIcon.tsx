import Svg, { Circle, Path } from "react-native-svg";
import type { BusinessContactKind } from "../lib/business-detail-presentation";

type IconName = BusinessContactKind | "scan" | "navigate" | "call" | "share";

export function BusinessIcon({ name, size = 22, color = "#E83E8C" }: { name: IconName; size?: number; color?: string }) {
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "scan") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" {...common} /></Svg>;
  if (name === "navigate") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="m4 11 16-7-7 16-2-7-7-2z" {...common} /></Svg>;
  if (name === "call") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M6.5 3.5 9 8l-2 2c1.4 3 3.6 5.2 6.5 6.5l2-2 4.5 2.5v3c0 .6-.4 1-1 1C10.2 21 3 13.8 3 5c0-.6.4-1 1-1l2.5-.5z" {...common} /></Svg>;
  if (name === "share") return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="18" cy="5" r="2.5" {...common}/><Circle cx="6" cy="12" r="2.5" {...common}/><Circle cx="18" cy="19" r="2.5" {...common}/><Path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" {...common}/></Svg>;
  if (name === "website") return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="12" r="9" {...common}/><Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" {...common}/></Svg>;
  if (name === "whatsapp") return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5z" {...common}/><Path d="M8.5 8c1 3.5 2.7 5.2 6 6" {...common}/></Svg>;
  const letter = name === "instagram" ? "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" : name === "facebook" ? "M14 21v-8h3l.5-4H14V7c0-1.2.5-2 2.5-2H19V2h-3c-3.5 0-6 2-6 5v2H9v4h3v8" : "M9 18a4 4 0 1 0 4-4V4c1 3 3 5 6 5";
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={letter} {...common}/>{name === "instagram" && <><Circle cx="12" cy="12" r="4" {...common}/><Circle cx="17.5" cy="6.5" r="1" fill={color}/></>}</Svg>;
}
