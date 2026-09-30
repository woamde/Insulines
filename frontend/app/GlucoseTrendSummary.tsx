import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useTheme } from "@/src/theme";
import { Card } from "@/src/components/ui";

interface TrendProps {
  timeSlots?: { label: string; period: string; trend: "up" | "down" | "stable"; avgDelta: string }[];
  postPrandialDelta?: number; // Ex: +35 mg/dL en moyenne après repas
}

export function GlucoseTrendSummary({ timeSlots, postPrandialDelta = 38 }: TrendProps) {
  const { colors } = useTheme();

  const defaultSlots = [
    { label: "Nuit", period: "00h–06h", trend: "stable", avgDelta: "≈ stable" },
    { label: "Matin", period: "06h–12h", trend: "up", avgDelta: "+42 mg/dL" },
    { label: "Après-midi", period: "12h–18h", trend: "down", avgDelta: "-28 mg/dL" },
    { label: "Soir", period: "18h–24h", trend: "up", avgDelta: "+35 mg/dL" },
  ];

  const slots = timeSlots ?? defaultSlots;

  return (
    <Card style={styles.card}>
      <Text style={[styles.title, { color: colors.onSurface }]}>Aperçu des variations & Repas</Text>

      {/* Impact post-prandial */}
      <View style={[styles.mealBanner, { backgroundColor: `${colors.brandPrimary}0E` }]}>
        <Text style={styles.mealIcon}>🍽️</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mealTitle, { color: colors.onSurface }]}>Excursion post-repas moyenne</Text>
          <Text style={[styles.mealSub, { color: colors.onSurfaceSecondary }]}>
            Hausse moyenne 2h après le repas :{" "}
            <Text style={{ fontWeight: "700", color: colors.warning }}>+{postPrandialDelta} mg/dL</Text>
          </Text>
        </View>
      </View>

      {/* Variation par tranche horaire */}
      <Text style={[styles.subTitle, { color: colors.onSurfaceSecondary }]}>Tendances par tranche horaire</Text>
      <View style={styles.grid}>
        {slots.map((item, idx) => (
          <View key={idx} style={[styles.slotItem, { backgroundColor: colors.surfaceTertiary ?? "#F5F5F5" }]}>
            <Text style={[styles.slotLabel, { color: colors.onSurface }]}>{item.label}</Text>
            <Text style={styles.slotPeriod}>{item.period}</Text>
            <View style={styles.trendRow}>
              <Ionicons
                name={
                  item.trend === "up"
                    ? "trending-up"
                    : item.trend === "down"
                    ? "trending-down"
                    : "remove"
                }
                size={16}
                color={
                  item.trend === "up"
                    ? colors.warning
                    : item.trend === "down"
                    ? colors.info
                    : colors.success
                }
              />
              <Text
                style={[
                  styles.trendText,
                  {
                    color:
                      item.trend === "up"
                        ? colors.warning
                        : item.trend === "down"
                        ? colors.info
                        : colors.success,
                  },
                ]}
              >
                {item.avgDelta}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 12,
  },
  subTitle: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  mealBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  mealIcon: {
    fontSize: 20,
  },
  mealTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  mealSub: {
    fontSize: 12,
  },
  grid: {
    flexDirection: "row",
    gap: 8,
  },
  slotItem: {
    flex: 1,
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  slotLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  slotPeriod: {
    fontSize: 10,
    color: "#888",
    marginBottom: 4,
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  trendText: {
    fontSize: 11,
    fontWeight: "600",
  },
});