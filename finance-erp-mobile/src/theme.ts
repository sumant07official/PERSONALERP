import { useColorScheme } from "react-native";

const light = {
  bg: "#f5f6f8", surface: "#ffffff", surface2: "#f0f2f5", border: "#e2e5ea", text: "#16191f", muted: "#6b7280",
  primary: "#0f766e", primaryFg: "#ffffff", primarySoft: "#e6f4f2",
  danger: "#c2410c", dangerSoft: "#fdeee6", success: "#15803d", successSoft: "#e8f6ec", warning: "#a16207", warningSoft: "#fdf6e3",
  header: "#0f1720", headerText: "#ffffff", headerMuted: "#9aa6b5", drawer: "#0f1720", drawerActive: "#1d2a36",
};
const dark: typeof light = {
  bg: "#0b0f14", surface: "#121821", surface2: "#18202b", border: "#243040", text: "#e6eaf0", muted: "#8b96a5",
  primary: "#2dd4bf", primaryFg: "#04201d", primarySoft: "#0f2f2c",
  danger: "#fb923c", dangerSoft: "#3a1d0e", success: "#4ade80", successSoft: "#0f2a19", warning: "#facc15", warningSoft: "#2e2608",
  header: "#080b10", headerText: "#ffffff", headerMuted: "#8b96a5", drawer: "#080b10", drawerActive: "#16202b",
};
export type Colors = typeof light;
export const useColors = (): Colors => (useColorScheme() === "dark" ? dark : light);
