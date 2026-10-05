// app/(tabs)/stats.tsx
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { makeStyles, useTheme } from "@/src/theme";
import * as ApiModule from "@/src/api";
import { unitsFor } from "@/src/units";

// Importations sécurisées des composants UI et graphiques
import * as UIModule from "@/src/components/ui";
const Card = UIModule.Card || (UIModule.default as any)?.Card || (({ children, style }: any) => <View style={style}>{children}</View>);
const Chip = UIModule.Chip || (UIModule.default as any)?.Chip || (() => null);
const ChipRow = UIModule.ChipRow || (UIModule.default as any)?.ChipRow || (({ children }: any) => <View>{children}</View>);
const EmptyState = UIModule.EmptyState || (UIModule.default as any)?.EmptyState || (() => null);
const ErrorState = UIModule.ErrorState || (UIModule.default as any)?.ErrorState || (() => null);
const LoadingState = UIModule.LoadingState || (UIModule.default as any)?.LoadingState || (() => null);
const PrimaryButton = UIModule.PrimaryButton || (UIModule.default as any)?.PrimaryButton || (() => null);
const StatTile = UIModule.StatTile || (UIModule.default as any)?.StatTile || (() => null);

import * as GlucoseChartModule from "@/src/components/GlucoseChart";
const GlucoseChart = GlucoseChartModule.GlucoseChart || (GlucoseChartModule as any).default || (() => null);

import * as DoctorReportModule from "@/src/components/DoctorReport";
const DoctorReport = DoctorReportModule.DoctorReport || (DoctorReportModule as any).default || (() => null);

// Fallbacks défensifs pour les hooks d'API
const useStats = (ApiModule as any).useStats || (() => ({ data: null, isLoading: false, isError: false, refetch: () => {} }));
const useProfile = (ApiModule as any).useProfile || (() => ({ data: null }));
const useActivities = (ApiModule as any).useActivities || (() => ({ data: [] }));
const useWeeklySummary = (ApiModule as any).useWeeklySummary || (() => ({ mutate: () => {}, isPending: false, data: null }));

import * as ToastModule from "@/src/components/Toast";
const useToast = (ToastModule as any).useToast || (() => ({ show: (msg: string) => console.log(msg) }));

import * as NavModule from "@/src/navigation";
const usesNativeTabs = (NavModule as any).usesNativeTabs ?? false;

const PERIODS = [
  { days: 7, label: "7 jours" },
  { days: 14, label: "14 jours" },
  { days: 30, label: "30 jours" },
];

export default function Stats() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [days, setDays] = useState(7);

  // Filtres d'interactivité du graphique
  const [showLow, setShowLow] = useState(true);
  const [showIn, setShowIn] = useState(true);
  const [showHigh, setShowHigh] = useState(true);
  const [showActivities, setShowActivities] = useState(true);

  const stats = useStats(days);
  const profile = useProfile();
  const activities = useActivities(200);
  const units = unitsFor(profile.data?.glucose_unit);
  const summary = useWeeklySummary();
  const toast = useToast();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const generateSummary = () => {
    summary.mutate(undefined, { onError: (e: any) => toast.show(e?.message || "Erreur", "error") });
  };

  // Résolution tolérante du nombre de mesures
  const readingsCount = stats.data?.readings_count ?? stats.data?.count ?? 0;
  const targetLow = stats.data?.target_low ?? 70;
  const targetHigh = stats.data?.target_high ?? 180;
  const tirGoal = stats.data?.tir_goal ?? 70;
  const tirIn = stats.data?.tir_in ?? stats.data?.in_range_pct ?? 0;
  const tirLow = stats.data?.tir_low ?? stats.data?.hypo_pct ?? 0;
  const tirHigh = stats.data?.tir_high ?? stats.data?.hyper_pct ?? 0;
  const avgGlucose = stats.data?.avg_glucose ?? stats.data?.average;

  const hasActivities = (stats.data?.activity_count ?? 0) > 0 || (activities.data ?? []).length > 0;

  // Preservation de la structure temporelle : on passe 'value: null' pour masquer sans casser l'axe X
  const rawSeries = stats?.data?.series || stats?.data?.data?.series || [];
  const chartPoints = rawSeries.map((s: any) => {
    const val = s.value_mgdl ?? s.value ?? 0;
    const isLow = val < targetLow;
    const isIn = val >= targetLow && val <= targetHigh;
    const isHigh = val > targetHigh;

    const isVisible =
      (isLow && showLow) ||
      (isIn && showIn) ||
      (isHigh && showHigh);

    return {
      value: isVisible ? val : null,
      at: s.measured_at ?? s.timestamp ?? s.date ?? new Date().toISOString(),
    };
  });

  // Filtrage des marqueurs d'activité physique
  const chartMarkers = showActivities
    ? (activities.data ?? []).map((a: any) => {
        const startDate = a?.started_at ? new Date(a.started_at) : new Date();
        const startTime = isNaN(startDate.getTime()) ? Date.now() : startDate.getTime();
        const duration = Number(a?.duration_min) || 0;

        return {
          ...a,
          start: a?.started_at || startDate.toISOString(),
          end: new Date(startTime + duration * 60_000).toISOString(),
        };
      })
    : [];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Statistiques</Text>
        <ChipRow>
          {PERIODS.map((p) => (
            <Chip key={p.days} label={p.label} selected={days === p.days} onPress={() => setDays(p.days)} testID={`stats-period-${p.days}`} />
          ))}
        </ChipRow>
      </View>

      {stats.isLoading ? (
        <LoadingState label="Génération des graphiques…" />
      ) : stats.isError ? (
        <ErrorState message="Erreur lors du calcul des statistiques." onRetry={() => stats.refetch()} />
      ) : !stats.data || readingsCount === 0 ? (
        <EmptyState
          icon={<Ionicons name="stats-chart" size={36} color={colors.brandPrimary} />}
          title="Pas assez de données"
          message="Enregistrez des glycémies pour visualiser vos tendances sur cette période."
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 24 }} showsVerticalScrollIndicator={false}>
          <Card testID="tir-card">
            <View style={styles.tirHeader}>
              <Text style={[styles.cardTitle, { marginBottom: 0, flex: 1 }]}>
                Temps dans la cible ({units.fmt(targetLow)}–{units.fmt(targetHigh)})
              </Text>
              <View
                style={[
                  styles.goalBadge,
                  { backgroundColor: `${tirIn >= tirGoal ? colors.success : colors.warning}1A` },
                ]}
                testID="tir-goal-badge"
              >
                <Ionicons
                  name={tirIn >= tirGoal ? "checkmark-circle" : "flag-outline"}
                  size={14}
                  color={tirIn >= tirGoal ? colors.success : colors.warning}
                />
                <Text style={[styles.goalText, { color: tirIn >= tirGoal ? colors.success : colors.warning }]}>
                  Objectif {tirGoal} %{tirIn >= tirGoal ? " atteint" : ""}
                </Text>
              </View>
            </View>
            <Text
              style={[styles.tirValue, { color: tirIn >= tirGoal ? colors.success : colors.warning }]}
              testID="tir-value"
            >
              {tirIn} %
            </Text>
            <View style={styles.tirBar}>
              <View style={{ flex: tirLow, backgroundColor: colors.error }} />
              <View style={{ flex: tirIn, backgroundColor: colors.success }} />
              <View style={{ flex: tirHigh, backgroundColor: colors.warning }} />
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
                <Text style={styles.legendText}>
                  Sous la cible &lt; {units.fmt(targetLow)} · {tirLow} %
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={styles.legendText}>Cible · {tirIn} %</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                <Text style={styles.legendText}>
                  Au-dessus &gt; {units.fmt(targetHigh)} · {tirHigh} %
                </Text>
              </View>
            </View>
            <Pressable onPress={() => router.push("/profil" as any)} style={styles.linkButton} testID="edit-targets-link" accessibilityRole="button">
              <Text style={styles.linkText}>Modifier mes objectifs</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brandPrimary} />
            </Pressable>
          </Card>

          <View style={styles.tilesGrid}>
            <StatTile
              label="Moyenne"
              value={avgGlucose != null ? units.fmt(avgGlucose) : "—"}
              unit={avgGlucose != null ? units.label : undefined}
              color={colors.brandPrimary}
            />
            <StatTile label="HbA1c estimée" value={stats.data.est_hba1c != null ? `${stats.data.est_hba1c}` : "—"} unit={stats.data.est_hba1c != null ? "%" : undefined} color={colors.brandPrimary} />
            <StatTile label="Mesures" value={`${readingsCount}`} color={colors.onSurface} />
          </View>
          <View style={styles.tilesGrid}>
            <StatTile
              label={`Sous cible (< ${units.fmt(targetLow)})`}
              value={`${stats.data.hypo_count ?? 0}`}
              color={(stats.data.hypo_count ?? 0) > 0 ? colors.error : colors.onSurface}
            />
            <StatTile
              label={`Au-dessus (> ${units.fmt(targetHigh)})`}
              value={`${stats.data.hyper_count ?? 0}`}
              color={(stats.data.hyper_count ?? 0) > 0 ? colors.warning : colors.onSurface}
            />
            <StatTile label="Glucides" value={`${stats.data.carbs_total ?? 0}`} unit="g" color={colors.onSurface} />
          </View>
          <View style={styles.tilesGrid}>
            <StatTile label="Basale (lente)" value={`${stats.data.basal_total ?? 0}`} unit="U" color={colors.brandPrimary} />
            <StatTile label="Bolus (rapide)" value={`${stats.data.bolus_total ?? 0}`} unit="U" color={colors.onSurface} />
            <StatTile label="Basale / jour" value={`${stats.data.basal_daily_avg ?? 0}`} unit="U" color={colors.onSurface} />
          </View>

          <Card testID="weight-card" style={{ marginTop: 12 }}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryIcon}>
                <Ionicons name="scale-outline" size={18} color={colors.onBrandTertiary} />
              </View>
              <Text style={[styles.cardTitle, { marginBottom: 0, flex: 1 }]}>Évolution du poids</Text>
              <Pressable onPress={() => router.push("/ajouter-poids" as any)} style={styles.linkButton} testID="weight-add-link" accessibilityRole="button">
                <Text style={styles.linkText}>Peser</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.brandPrimary} />
              </Pressable>
            </View>
            {(stats.data.weight_count ?? 0) > 0 && stats.data.weight_delta != null ? (
              <View style={styles.weightRow} testID="weight-summary">
                <Text style={styles.weightValue}>{stats.data.weight_end} kg</Text>
                <View style={[styles.weightBadge, { backgroundColor: `${stats.data.weight_delta > 0 ? colors.warning : stats.data.weight_delta < 0 ? colors.info : colors.muted}1A` }]}>
                  <Ionicons
                    name={stats.data.weight_delta > 0 ? "trending-up" : stats.data.weight_delta < 0 ? "trending-down" : "remove"}
                    size={16}
                    color={stats.data.weight_delta > 0 ? colors.warning : stats.data.weight_delta < 0 ? colors.info : colors.muted}
                  />
                  <Text style={[styles.weightDelta, { color: stats.data.weight_delta > 0 ? colors.warning : stats.data.weight_delta < 0 ? colors.info : colors.muted }]}>
                    {stats.data.weight_delta > 0 ? "+" : ""}{stats.data.weight_delta} kg
                  </Text>
                </View>
                <Text style={styles.weightMeta}>
                  {(stats.data.weight_count ?? 0) > 1 ? `depuis ${stats.data.weight_start} kg · ${stats.data.weight_count} pesées` : "1 pesée sur la période"}
                </Text>
              </View>
            ) : (
              <Text style={styles.summaryHint}>Aucune pesée sur cette période. Enregistrez votre poids pour suivre la tendance.</Text>
            )}
          </Card>

          <DoctorReport />

          <Card testID="ai-summary-card" style={{ marginTop: 12 }}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryIcon}>
                <Ionicons name="sparkles" size={18} color={colors.onBrandTertiary} />
              </View>
              <Text style={styles.cardTitle}>Bilan IA de la semaine</Text>
            </View>
            {summary.data ? (
              <Text style={styles.summaryText} testID="ai-summary-text">{summary.data.summary}</Text>
            ) : (
              <Text style={styles.summaryHint}>
                Générez un résumé personnalisé de vos tendances des 7 derniers jours.
              </Text>
            )}
            <PrimaryButton
              label={summary.data ? "Régénérer le bilan" : "Générer mon bilan"}
              onPress={generateSummary}
              loading={summary.isPending}
              variant="secondary"
              testID="generate-summary-button"
            />
          </Card>

          <Card testID="glucose-evolution-card" style={{ marginTop: 12 }}>
            <Text style={styles.cardTitle}>Évolution de la glycémie</Text>

            {/* Légende interactive */}
            <View style={styles.chartLegend}>
              <Pressable
                style={[styles.chartLegendItem, !showLow && styles.legendItemDisabled]}
                onPress={() => setShowLow((prev) => !prev)}
                accessibilityRole="button"
              >
                <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.chartLegendText, !showLow && styles.textDisabled]}>
                  Sous la cible (&lt; {units.fmt(targetLow)})
                </Text>
              </Pressable>

              <Pressable
                style={[styles.chartLegendItem, !showIn && styles.legendItemDisabled]}
                onPress={() => setShowIn((prev) => !prev)}
                accessibilityRole="button"
              >
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.chartLegendText, !showIn && styles.textDisabled]}>
                  Dans la cible ({units.fmt(targetLow)}–{units.fmt(targetHigh)})
                </Text>
              </Pressable>

              <Pressable
                style={[styles.chartLegendItem, !showHigh && styles.legendItemDisabled]}
                onPress={() => setShowHigh((prev) => !prev)}
                accessibilityRole="button"
              >
                <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                <Text style={[styles.chartLegendText, !showHigh && styles.textDisabled]}>
                  Au-dessus (&gt; {units.fmt(targetHigh)})
                </Text>
              </Pressable>

              {hasActivities && (
                <Pressable
                  style={[styles.chartLegendItem, !showActivities && styles.legendItemDisabled]}
                  onPress={() => setShowActivities((prev) => !prev)}
                  accessibilityRole="button"
                >
                  <View style={[styles.legendDot, { backgroundColor: colors.info }]} />
                  <Text style={[styles.chartLegendText, !showActivities && styles.textDisabled]}>
                    Activité physique
                  </Text>
                </Pressable>
              )}
            </View>

            <GlucoseChart
              points={chartPoints}
              targets={{ low: targetLow, high: targetHigh }}
              unit={units.unit}
              markers={chartMarkers}
            />

            {(stats.data.activity_count ?? 0) > 0 && showActivities ? (
              <Text style={styles.chartHint} testID="activity-chart-hint">
                {stats.data.activity_count} séance{stats.data.activity_count > 1 ? "s" : ""} de sport ({stats.data.activity_minutes ?? 0} min) sur la période — bandes bleues sur la courbe
              </Text>
            ) : null}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 4,
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
    marginBottom: 8,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 12,
  },
  tirValue: {
    fontSize: 40,
    fontWeight: "500",
    marginBottom: 10,
  },
  chartHint: {
    color: colors.info,
    fontSize: 12,
    marginTop: 8,
  },
  chartLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },
  chartLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  legendItemDisabled: {
    opacity: 0.35,
  },
  textDisabled: {
    textDecorationLine: "line-through",
  },
  chartLegendText: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
  },
  tirHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  goalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  goalText: {
    fontSize: 12,
    fontWeight: "500",
  },
  tirBar: {
    flexDirection: "row",
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
  },
  legend: {
    marginTop: 12,
    gap: 6,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
  },
  tilesGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryText: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 12,
  },
  summaryHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  linkText: {
    color: colors.brandPrimary,
    fontSize: 14,
    fontWeight: "500",
  },
  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  weightValue: {
    color: colors.onSurface,
    fontSize: 28,
    fontWeight: "500",
  },
  weightBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  weightDelta: {
    fontSize: 13,
    fontWeight: "500",
  },
  weightMeta: {
    color: colors.muted,
    fontSize: 12,
  },
}));