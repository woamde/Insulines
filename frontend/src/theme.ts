// Design tokens for this app. Light theme (clair et médical) per
// /app/design_guidelines.json. Keys match the "color" block of that file.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#F8FAFC",
  onSurface: "#0F172A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1E293B",
  surfaceTertiary: "#F1F5F9",
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#0F172A",
  onSurfaceInverse: "#F8FAFC",
  muted: "#64748B",

  // Brand
  brand: "#0EA5E9",
  onBrand: "#FFFFFF",
  brandPrimary: "#0284C7",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#38BDF8",
  onBrandSecondary: "#0F172A",
  brandTertiary: "#E0F2FE",
  onBrandTertiary: "#075985",

  // Status
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#06B6D4",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  divider: "#F1F5F9",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system === "light" || system === "dark" ? (themes[system] ? system : defaultScheme) : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
