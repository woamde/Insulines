import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";

import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, useTheme } from "@/src/theme";
import { fileUrl, useDeleteGlucose, useDeleteInsulin, useDeleteMeal, useDeleteWeight, useActivities, useDeleteActivity, useGlucose, useInsulin, useMeals, useProfile, useWeights } from "@/src/api";
import { unitsFor } from "@/src/units";
import { ACTIVITY_LABELS, CONTEXT_LABELS, INSULIN_KIND_LABELS, INTENSITY_LABELS, MEAL_TYPE_LABELS, SOURCE_LABELS, formatDayLabel, formatTime, glucoseZone, round1, targetsOf, zoneColor } from "@/src/glucose";
import { Card, Chip, ChipRow, EmptyState, ErrorState, LoadingState } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

const FILTERS = [
  { key: "tout", label: "Tout" },
  { key: "glycemie", label: "Glycémies" },
  { key: "repas", label: "Repas" },
  { key: "insuline", label: "Insuline" },
  { key: "poids", label: "Poids" },
  { key: "activite", label: "Activité" },
] as const;

type Row =
  | { key: string; kind: "glucose"; id: string; at: string; value: number; context: string; source?: string }
  | { key: string; kind: "meal"; id: string; at: string; name: string; mealType: string; carbs: number; insulin: number | null; photo: string | null; note: string }
  | { key: string; kind: "insulin"; id: string; at: string; units: number; insulinKind: string; name: string; note: string }
  | { key: string; kind: "weight"; id: string; at: string; weight: number; note: string }
  | { key: string; kind: "activity"; id: string; at: string; activityType: string; duration: number; intensity: string; note: string };

export default function Journal() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();

  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("tout");
  const glucose = useGlucose(300);
  const meals = useMeals(300);
  const insulin = useInsulin(300);
  const weights = useWeights(100);
  const profile = useProfile();
  const targets = targetsOf(profile.data);
  const units = unitsFor(profile.data?.glucose_unit);
  const activities = useActivities(300);
  const delActivity = useDeleteActivity();
  const delGlucose = useDeleteGlucose();
  const delMeal = useDeleteMeal();
  const delInsulin = useDeleteInsulin();
  const delWeight = useDeleteWeight();

  const readings = glucose.data ?? [];
  const mealList = meals.data ?? [];
  const doses = insulin.data ?? [];
  const weightList = weights.data ?? [];
  const activityList = activities.data ?? [];

  const sections = useMemo(() => {
    const rows: Row[] = [];
    if (filter === "tout" || filter === "glycemie") {
      for (const r of readings) {
        rows.push({ key: `g-${r.id}`, kind: "glucose", id: r.id, at: r.measured_at, value: r.value_mgdl, context: r.context, source: r.source });
      }
    }
    if (filter === "tout" || filter === "repas") {
      for (const m of mealList) {
        rows.push({
          key: `m-${m.id}`,
          kind: "meal",
          id: m.id,
          at: m.eaten_at,
          name: m.name || MEAL_TYPE_LABELS[m.meal_type] || "Repas",
          mealType: m.meal_type,
          carbs: m.carbs_g,
          insulin: m.insulin_units,
          photo: m.photo_path,
          note: m.note,
        });
      }
    }
    if (filter === "tout" || filter === "insuline") {
      for (const d of doses) {
        rows.push({ key: `i-${d.id}`, kind: "insulin", id: d.id, at: d.injected_at, units: d.units, insulinKind: d.kind, name: d.insulin_name, note: d.note });
      }
    }
    if (filter === "tout" || filter === "poids") {
      for (const w of weightList) {
        rows.push({ key: `w-${w.id}`, kind: "weight", id: w.id, at: w.measured_at, weight: w.weight_kg, note: w.note });
      }
    }
    if (filter === "tout" || filter === "activite") {
      for (const a of activityList) {
        rows.push({ key: `a-${a.id}`, kind: "activity", id: a.id, at: a.started_at, activityType: a.activity_type, duration: a.duration_min, intensity: a.intensity, note: a.note });
      }
    }
    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const label = formatDayLabel(row.at);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(row);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [readings, mealList, doses, weightList, activityList, filter]);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const loading = glucose.isLoading || meals.isLoading;
  const error = glucose.isError || meals.isError;
  const refetchAll = () => {
    glucose.refetch();
    meals.refetch();
    insulin.refetch();
    weights.refetch();
    activities.refetch();
  };

  const handleDelete = (row: Row) => {
    const opts = (label: string) => ({ onSuccess: () => toast.show(label, "success" as const), onError: (e: Error) => toast.show(e.message, "error" as const) });
    if (row.kind === "glucose") delGlucose.mutate(row.id, opts("Mesure supprimée"));
    else if (row.kind === "meal") delMeal.mutate(row.id, opts("Repas supprimé"));
    else if (row.kind === "insulin") delInsulin.mutate(row.id, opts("Injection supprimée"));
    else if (row.kind === "activity") delActivity.mutate(row.id, opts("Activité supprimée"));
    else delWeight.mutate(row.id, opts("Pesée supprimée"));
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Journal</Text>
        <ChipRow>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} testID={`journal-filter-${f.key}`} />
          ))}
        </ChipRow>
      </View>

      {loading ? (
        <LoadingState label="Chargement du journal…" />
      ) : error ? (
        <ErrorState message="Impossible de charger l'historique." onRetry={refetchAll} />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<Ionicons name="book" size={36} color={colors.brandPrimary} />}
          title="Votre journal est vide"
          message="Enregistrez votre premier repas ou votre première mesure."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={glucose.isFetching || meals.isFetching} onRefresh={refetchAll} tintColor={colors.brandPrimary} />
          }
        >
          {sections.map((section) => (
            <View key={section.label} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <Card testID="journal-section-card">
                {section.items.map((row) => (
                  <View key={row.key} style={styles.row}>
                    {row.kind === "glucose" ? (
                      <>
                        <View style={[styles.rowIcon, { backgroundColor: `${zoneColor(glucoseZone(row.value, targets), colors)}1A` }]}>
                          <Ionicons name="water" size={16} color={zoneColor(glucoseZone(row.value, targets), colors)} />
                        </View>
                        <View style={styles.rowMain}>
                          <Text style={[styles.rowTitle, { color: zoneColor(glucoseZone(row.value, targets), colors) }]}>{units.fmt(row.value)} {units.label}</Text>
                          <Text style={styles.rowMeta}>
                            {[CONTEXT_LABELS[row.context], row.source && row.source !== "manuel" ? SOURCE_LABELS[row.source] : null].filter(Boolean).join(" · ") || "Mesure"}
                          </Text>
                        </View>
                      </>
                    ) : row.kind === "insulin" ? (
                      <>
                        <View style={[styles.rowIcon, { backgroundColor: `${colors.info}1A` }]}>
                          <Ionicons name="medkit" size={16} color={colors.info} />
                        </View>
                        <View style={styles.rowMain}>
                          <Text style={styles.rowTitleDark}>{round1(row.units)} U · {INSULIN_KIND_LABELS[row.insulinKind] ?? row.insulinKind}</Text>
                          <Text style={styles.rowMeta}>
                            {row.name || (row.insulinKind === "basale" ? "Insuline lente" : "Insuline rapide")}
                            {row.note ? ` · ${row.note}` : ""}
                          </Text>
                        </View>
                      </>
                    ) : row.kind === "activity" ? (
                      <>
                        <View style={[styles.rowIcon, { backgroundColor: `${colors.info}1A` }]}>
                          <Ionicons name="fitness" size={16} color={colors.info} />
                        </View>
                        <View style={styles.rowMain}>
                          <Text style={styles.rowTitleDark}>{ACTIVITY_LABELS[row.activityType] ?? row.activityType} · {row.duration} min</Text>
                          <Text style={styles.rowMeta}>Intensité {INTENSITY_LABELS[row.intensity]?.toLowerCase() ?? row.intensity}{row.note ? ` · ${row.note}` : ""}</Text>
                        </View>
                      </>
                    ) : row.kind === "weight" ? (
                      <>
                        <View style={[styles.rowIcon, { backgroundColor: colors.surfaceTertiary }]}>
                          <Ionicons name="scale-outline" size={16} color={colors.onSurfaceSecondary} />
                        </View>
                        <View style={styles.rowMain}>
                          <Text style={styles.rowTitleDark}>{round1(row.weight)} kg</Text>
                          <Text style={styles.rowMeta}>Poids{row.note ? ` · ${row.note}` : ""}</Text>
                        </View>
                      </>
                    ) : (
                      <>
                        {row.photo ? (
                          <Image source={{ uri: fileUrl(row.photo) }} style={styles.rowPhoto} contentFit="cover" transition={150} />
                        ) : (
                          <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
                            <Ionicons name="restaurant" size={16} color={colors.onBrandTertiary} />
                          </View>
                        )}
                        <View style={styles.rowMain}>
                          <Text style={styles.rowTitleDark}>{row.name}</Text>
                          <Text style={styles.rowMeta}>
                            {MEAL_TYPE_LABELS[row.mealType] ?? "Repas"} · {round1(row.carbs)} g glucides
                            {row.insulin ? ` · ${round1(row.insulin)} U` : ""}
                            {row.note ? ` · ${row.note}` : ""}
                          </Text>
                        </View>
                      </>
                    )}
                    <Text style={styles.rowTime}>{formatTime(row.at)}</Text>
                    <Pressable onPress={() => handleDelete(row)} style={styles.deleteButton} hitSlop={8} testID={`delete-${row.key}`} accessibilityRole="button">
                      <Ionicons name="trash-outline" size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          ))}
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
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 8,
    textTransform: "capitalize",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rowPhoto: {
    width: 40,
    height: 40,
    borderRadius: 14,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "500",
  },
  rowTitleDark: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  rowTime: {
    color: colors.muted,
    fontSize: 12,
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
}));
