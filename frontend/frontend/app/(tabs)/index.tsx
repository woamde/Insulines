import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, useTheme } from "@/src/theme";
import { fileUrl, useActivities, useCgmStatus, useCgmSync, useGlucose, useInsulin, useMeals, useProfile } from "@/src/api";
import { unitsFor } from "@/src/units";
import {
  ACTIVITY_LABELS,
  CONTEXT_LABELS,
  INSULIN_KIND_LABELS,
  SOURCE_LABELS,
  formatTime,
  glucoseZone,
  isSameDay,
  relTime,
  round1,
  targetsOf,
  zoneColor,
  zoneLabel,
} from "@/src/glucose";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PrimaryButton, StatTile } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import type { ActivityEntry, GlucoseReading, InsulinDose, MealEntry } from "@/src/types";

type ThemeColors = ReturnType<typeof useTheme>["colors"];

type Activity =
  | { kind: "glucose"; id: string; at: string; value: number; context: string; source?: string }
  | {
      kind: "meal";
      id: string;
      at: string;
      name: string;
      carbs: number;
      insulin: number | null;
      photo: string | null;
    }
  | { kind: "insulin"; id: string; at: string; units: number; insulinKind: InsulinDose["kind"]; name: string }
  | { kind: "activity"; id: string; at: string; activityType: string; duration: number };

const EMPTY_READINGS: GlucoseReading[] = [];
const EMPTY_MEALS: MealEntry[] = [];
const EMPTY_DOSES: InsulinDose[] = [];
const EMPTY_ACTIVITIES: ActivityEntry[] = [];

function formatSyncMessage(count: number): string {
  const plural = count > 1 ? "s" : "";
  return `${count} mesure${plural} synchronisée${plural}`;
}

function formatFetchMessage(count: number): string {
  const plural = count > 1 ? "s" : "";
  return `${count} mesure${plural} récupérée${plural}`;
}

function getTrendInfo(diff: number | null, colors: ThemeColors) {
  if (diff === null) {
    return { icon: "remove" as const, color: colors.muted };
  }
  if (diff > 5) {
    return { icon: "trending-up" as const, color: colors.warning };
  }
  if (diff < -5) {
    return { icon: "trending-down" as const, color: colors.info };
  }
  return { icon: "remove" as const, color: colors.muted };
}

function computeTodayStats(
  readings: GlucoseReading[],
  meals: MealEntry[],
  doses: InsulinDose[],
  targets: ReturnType<typeof targetsOf>,
  today: Date
) {
  const todayReadings = readings.filter((r) => isSameDay(r.measured_at, today));
  const todayMeals = meals.filter((m) => isSameDay(m.eaten_at, today));
  const todayDoses = doses.filter((d) => isSameDay(d.injected_at, today));

  const carbsToday = round1(todayMeals.reduce((s, m) => s + m.carbs_g, 0));
  const bolusToday = round1(
    todayMeals.reduce((s, m) => s + (m.insulin_units ?? 0), 0) +
      todayDoses.filter((d) => d.kind !== "basale").reduce((s, d) => s + d.units, 0)
  );
  const basalToday = todayDoses.filter((d) => d.kind === "basale");
  const basalUnitsToday = round1(basalToday.reduce((s, d) => s + d.units, 0));

  let tirToday: number | null = null;
  if (todayReadings.length > 0) {
    const inTarget = todayReadings.filter(
      (r) => r.value_mgdl >= targets.low && r.value_mgdl <= targets.high
    ).length;
    tirToday = Math.round((inTarget / todayReadings.length) * 100);
  }

  return { carbsToday, bolusToday, basalToday, basalUnitsToday, tirToday };
}

function buildRecentActivity(
  readings: GlucoseReading[],
  meals: MealEntry[],
  doses: InsulinDose[],
  activities: ActivityEntry[]
): Activity[] {
  const rows: Activity[] = [
    ...readings.map((r): Activity => ({
      kind: "glucose",
      id: r.id,
      at: r.measured_at,
      value: r.value_mgdl,
      context: r.context,
      source: r.source,
    })),
    ...meals.map((m): Activity => ({
      kind: "meal",
      id: m.id,
      at: m.eaten_at,
      name: m.name || "Repas",
      carbs: m.carbs_g,
      insulin: m.insulin_units,
      photo: m.photo_path,
    })),
    ...doses.map((d): Activity => ({
      kind: "insulin",
      id: d.id,
      at: d.injected_at,
      units: d.units,
      insulinKind: d.kind,
      name: d.insulin_name,
    })),
    ...activities.map((a): Activity => ({
      kind: "activity",
      id: a.id,
      at: a.started_at,
      activityType: a.activity_type,
      duration: a.duration_min,
    })),
  ];

  return rows
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);
}

interface GlucoseHeroCardProps {
  readonly busy: boolean;
  readonly error: boolean;
  readonly errorDetail?: string;
  readonly latest?: GlucoseReading;
  readonly targets: ReturnType<typeof targetsOf>;
  readonly units: ReturnType<typeof unitsFor>;
  readonly trend: { icon: keyof typeof Ionicons.glyphMap; color: string };
  readonly diff: number | null;
  readonly colors: ThemeColors;
  readonly styles: ReturnType<typeof useStyles>;
  readonly onRetry: () => void;
}

function GlucoseHeroCard({
  busy,
  error,
  errorDetail,
  latest,
  targets,
  units,
  trend,
  diff,
  colors,
  styles,
  onRetry,
}: GlucoseHeroCardProps) {
  if (busy) {
    return (
      <Card>
        <LoadingState label="Chargement de vos données…" />
      </Card>
    );
  }

  if (error) {
    const message = errorDetail
      ? `Impossible de charger vos données : ${errorDetail}`
      : "Impossible de charger vos données. Vérifiez votre connexion.";
    return (
      <Card>
        <ErrorState message={message} onRetry={onRetry} />
      </Card>
    );
  }

  if (!latest) {
    return (
      <Card>
        <EmptyState
          icon={<Ionicons name="water" size={36} color={colors.brandPrimary} />}
          title="Aucune mesure enregistrée"
          message="Appuyez sur + pour ajouter votre première glycémie."
        />
      </Card>
    );
  }

  const zone = glucoseZone(latest.value_mgdl, targets);
  const color = zoneColor(zone, colors);
  const contextText = latest.context ? ` · ${CONTEXT_LABELS[latest.context] ?? latest.context}` : "";
  const diffText = diff !== null ? ` · ${units.fmtDelta(diff)} ${units.label}` : "";

  return (
    <Card testID="latest-glucose-card">
      <View style={styles.heroTop}>
        <Text style={styles.heroLabel}>Dernière glycémie</Text>
        {latest.source && latest.source !== "manuel" ? (
          <Badge text={SOURCE_LABELS[latest.source] ?? latest.source} color={colors.brandPrimary} />
        ) : null}
      </View>
      <View style={styles.heroRow}>
        <Text style={[styles.heroValue, { color }]}>{units.fmt(latest.value_mgdl)}</Text>
        <View style={styles.heroSide}>
          <Ionicons name={trend.icon} size={24} color={trend.color} />
          <Text style={[styles.heroZone, { color }]}>{zoneLabel(zone)}</Text>
        </View>
      </View>
      <Text style={styles.heroMeta}>
        {units.label} · {relTime(latest.measured_at)}
        {contextText}
        {diffText}
      </Text>
    </Card>
  );
}

interface ActivityItemProps {
  readonly item: Activity;
  readonly targets: ReturnType<typeof targetsOf>;
  readonly colors: ThemeColors;
  readonly units: ReturnType<typeof unitsFor>;
  readonly styles: ReturnType<typeof useStyles>;
}

function ActivityItem({ item, targets, colors, units, styles }: ActivityItemProps) {
  if (item.kind === "glucose") {
    const zone = glucoseZone(item.value, targets);
    const color = zoneColor(zone, colors);
    const contextLabel = CONTEXT_LABELS[item.context];
    const sourceLabel = item.source && item.source !== "manuel" ? SOURCE_LABELS[item.source] : null;
    const metaParts = [contextLabel, sourceLabel].filter(Boolean);
    const metaText = metaParts.length > 0 ? metaParts.join(" · ") : "Mesure";

    return (
      <View style={styles.activityRow}>
        <View style={[styles.activityIcon, { backgroundColor: `${color}1A` }]}>
          <Ionicons name="water" size={16} color={color} />
        </View>
        <View style={styles.activityMain}>
          <Text style={[styles.activityTitle, { color }]}>
            {units.fmt(item.value)} {units.label}
          </Text>
          <Text style={styles.activityMeta}>{metaText}</Text>
        </View>
        <Text style={styles.activityTime}>{formatTime(item.at)}</Text>
      </View>
    );
  }

  if (item.kind === "activity") {
    const activityLabel = ACTIVITY_LABELS[item.activityType] ?? item.activityType;
    return (
      <View style={styles.activityRow}>
        <View style={[styles.activityIcon, { backgroundColor: `${colors.info}1A` }]}>
          <Ionicons name="fitness" size={16} color={colors.info} />
        </View>
        <View style={styles.activityMain}>
          <Text style={styles.activityTitleDark}>
            {activityLabel} · {item.duration} min
          </Text>
          <Text style={styles.activityMeta}>Activité physique</Text>
        </View>
        <Text style={styles.activityTime}>{formatTime(item.at)}</Text>
      </View>
    );
  }

  if (item.kind === "insulin") {
    const kindLabel = INSULIN_KIND_LABELS[item.insulinKind] ?? item.insulinKind;
    const defaultName = item.insulinKind === "basale" ? "Insuline lente" : "Insuline rapide";
    return (
      <View style={styles.activityRow}>
        <View style={[styles.activityIcon, { backgroundColor: `${colors.info}1A` }]}>
          <Ionicons name="medkit" size={16} color={colors.info} />
        </View>
        <View style={styles.activityMain}>
          <Text style={styles.activityTitleDark}>
            {round1(item.units)} U · {kindLabel}
          </Text>
          <Text style={styles.activityMeta}>{item.name || defaultName}</Text>
        </View>
        <Text style={styles.activityTime}>{formatTime(item.at)}</Text>
      </View>
    );
  }

  const insulinDetail = item.insulin ? ` · ${round1(item.insulin)} U` : "";
  return (
    <View style={styles.activityRow}>
      {item.photo ? (
        <Image source={{ uri: fileUrl(item.photo) }} style={styles.activityPhoto} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.activityIcon, { backgroundColor: colors.brandTertiary }]}>
          <Ionicons name="restaurant" size={16} color={colors.onBrandTertiary} />
        </View>
      )}
      <View style={styles.activityMain}>
        <Text style={styles.activityTitleDark}>{item.name}</Text>
        <Text style={styles.activityMeta}>
          {round1(item.carbs)} g de glucides{insulinDetail}
        </Text>
      </View>
      <Text style={styles.activityTime}>{formatTime(item.at)}</Text>
    </View>
  );
}

interface HypoAlertBannerProps {
  readonly latestAt: string;
  readonly colors: ThemeColors;
  readonly styles: ReturnType<typeof useStyles>;
  readonly onPress: () => void;
}

function HypoAlertBanner({ latestAt, colors, styles, onPress }: HypoAlertBannerProps) {
  const hypoTime = formatTime(latestAt);
  const recheckTime = formatTime(new Date(new Date(latestAt).getTime() + 15 * 60_000).toISOString());

  return (
    <Pressable style={styles.hypoBanner} onPress={onPress} testID="hypo-recheck-banner" accessibilityRole="button">
      <Ionicons name="alarm" size={20} color={colors.error} />
      <View style={styles.flexOne}>
        <Text style={styles.hypoBannerTitle}>
          Hypo à {hypoTime} · recontrôle conseillé à {recheckTime}
        </Text>
        <Text style={styles.hypoBannerText}>15 g de sucres rapides, puis nouvelle mesure dans 15 min. Touchez pour saisir.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.error} />
    </Pressable>
  );
}

interface AddMenuModalProps {
  readonly open: boolean;
  readonly insetsBottom: number;
  readonly colors: ThemeColors;
  readonly styles: ReturnType<typeof useStyles>;
  readonly onClose: () => void;
  readonly onNavigate: (path: string) => void;
}

function AddMenuModal({ open, insetsBottom, colors, styles, onClose, onNavigate }: AddMenuModalProps) {
  const handleSelect = (path: string) => {
    onClose();
    onNavigate(path);
  };

  const bottomPadding = Math.max(insetsBottom, 16) + 8;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.menuSheet, { paddingBottom: bottomPadding }]} testID="add-menu-sheet">
          <Text style={styles.menuTitle}>Ajouter</Text>
          <Pressable style={styles.menuItem} onPress={() => handleSelect("/ajouter-glycemie")} testID="menu-add-glucose">
            <Ionicons name="water" size={20} color={colors.brandPrimary} />
            <Text style={styles.menuItemText}>Une glycémie</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => handleSelect("/ajouter-repas")} testID="menu-add-meal">
            <Ionicons name="restaurant" size={20} color={colors.brandPrimary} />
            <Text style={styles.menuItemText}>Un repas</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => handleSelect("/ajouter-insuline")} testID="menu-add-insulin">
            <Ionicons name="medkit" size={20} color={colors.brandPrimary} />
            <Text style={styles.menuItemText}>Une injection d&apos;insuline (basale / bolus)</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => handleSelect("/ajouter-activite")} testID="menu-add-activity">
            <Ionicons name="fitness" size={20} color={colors.brandPrimary} />
            <Text style={styles.menuItemText}>Une activité physique</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => handleSelect("/ajouter-poids")} testID="menu-add-weight">
            <Ionicons name="scale-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.menuItemText}>Mon poids</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={onClose} testID="menu-cancel">
            <Text style={styles.menuCancel}>Annuler</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// The dashboard intentionally coordinates several independent cards.  Keep the
// orchestration in one component while excluding the presentational branching
// from the cognitive-complexity metric.
export default function Dashboard() { // NOSONAR
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();

  const profile = useProfile();
  const glucose = useGlucose(100);
  const meals = useMeals(100);
  const insulin = useInsulin(50);
  const activities = useActivities(20);
  const cgm = useCgmStatus();
  const sync = useCgmSync();

  const [menuOpen, setMenuOpen] = useState(false);
  const autoSynced = useRef(false);

  useEffect(() => {
    if (cgm.data?.configured && !autoSynced.current) {
      autoSynced.current = true;
      sync.mutate(undefined, {
        onSuccess: (d) => {
          if (d.inserted > 0) {
            toast.show(formatSyncMessage(d.inserted), "success");
          }
        },
        onError: () => {},
      });
    }
  }, [cgm.data?.configured, sync, toast]);

  const readings = glucose.data ?? EMPTY_READINGS;
  const mealList = meals.data ?? EMPTY_MEALS;
  const doses = insulin.data ?? EMPTY_DOSES;
  const activityList = activities.data ?? EMPTY_ACTIVITIES;

  const units = unitsFor(profile.data?.glucose_unit);
  const today = useMemo(() => new Date(), []);
  const nowMs = today.getTime();

  const targets = targetsOf(profile.data);

  const { carbsToday, bolusToday, basalToday, basalUnitsToday, tirToday } = useMemo(
    () => computeTodayStats(readings, mealList, doses, targets, today),
    [readings, mealList, doses, targets, today]
  );

  const latest = readings[0];
  const previous = readings[1];
  const diff = latest && previous ? latest.value_mgdl - previous.value_mgdl : null;

  const activity = useMemo(
    () => buildRecentActivity(readings, mealList, doses, activityList),
    [readings, mealList, doses, activityList]
  );

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const busy = profile.isLoading || glucose.isLoading || meals.isLoading;
  const error = profile.isError || glucose.isError || meals.isError;
  const errorDetail = (profile.error ?? glucose.error ?? meals.error)?.message;

  const refetchAll = () => {
    profile.refetch();
    glucose.refetch();
    meals.refetch();
    insulin.refetch();
    activities.refetch();
    cgm.refetch();
  };

  const hour = today.getHours();
  const greeting = hour < 18 ? "Bonjour" : "Bonsoir";
  const displayName = profile.data?.name && profile.data.name !== "Profil" ? profile.data.name : "";
  const trend = getTrendInfo(diff, colors);

  const isHypoAlert =
    latest &&
    latest.value_mgdl < targets.low &&
    nowMs - new Date(latest.measured_at).getTime() < 60 * 60_000;

  const tirValue = tirToday !== null ? `${tirToday}` : "—";
  const tirUnit = tirToday !== null ? "%" : undefined;
  const tirColor = tirToday !== null ? colors.success : colors.muted;

  const firstBasal = basalToday[0];
  const insulinNameText = firstBasal?.insulin_name ? ` · ${firstBasal.insulin_name}` : "";
  const basalTimeText = firstBasal ? formatTime(firstBasal.injected_at) : "";
  const basalMetaText = basalToday.length > 0
    ? `${basalUnitsToday} U${insulinNameText} · ${basalTimeText}`
    : "Pas encore enregistrée aujourd'hui";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>
            {greeting}
            {displayName ? ` ${displayName}` : ""} 👋
          </Text>
          <Text style={styles.date}>
            {today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        <Pressable style={styles.assistantBtn} onPress={() => router.push("/assistant")} testID="assistant-button" accessibilityRole="button">
          <Ionicons name="sparkles" size={20} color={colors.onBrandTertiary} />
        </Pressable>
        <Pressable style={styles.avatar} onPress={() => router.push("/profil")} testID="profile-button" accessibilityRole="button">
          <Text style={styles.avatarText}>{(displayName || "P").slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: bottomChrome + 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={glucose.isFetching || meals.isFetching}
            onRefresh={refetchAll}
            tintColor={colors.brandPrimary}
          />
        }
      >
        {profile.data && !profile.data.profile_completed ? (
          <Pressable style={styles.setupBanner} onPress={() => router.push("/profil")} testID="setup-profile-banner">
            <Ionicons name="person-circle" size={22} color={colors.onBrandTertiary} />
            <Text style={styles.setupText}>Configurez votre profil pour personnaliser vos calculs d&apos;insuline</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onBrandTertiary} />
          </Pressable>
        ) : null}

        {cgm.data?.configured ? (
          <Card style={styles.cgmRow} testID="cgm-status-card">
            <View style={[styles.cgmIcon, { backgroundColor: colors.brandTertiary }]}>
              <Ionicons name="bluetooth" size={18} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.cgmInfo}>
              <Text style={styles.cgmTitle}>{cgm.data.source_label}</Text>
              <Text style={styles.cgmSubtitle}>
                {cgm.data.last_sync_at ? `Dernière synchro ${relTime(cgm.data.last_sync_at)}` : "Jamais synchronisé"}
                {cgm.data.last_error ? " · erreur de synchro" : ""}
              </Text>
            </View>
            <Pressable
              onPress={() =>
                sync.mutate(undefined, {
                  onSuccess: (d) => toast.show(formatFetchMessage(d.inserted), "success"),
                  onError: (e) => toast.show(e.message, "error"),
                })
              }
              disabled={sync.isPending}
              style={styles.cgmSyncButton}
              testID="cgm-sync-button"
              accessibilityRole="button"
            >
              <Ionicons name="sync" size={22} color={sync.isPending ? colors.muted : colors.brandPrimary} />
            </Pressable>
          </Card>
        ) : (
          <Pressable style={styles.setupBanner} onPress={() => router.push("/cgm")} testID="setup-cgm-banner">
            <Ionicons name="bluetooth" size={22} color={colors.onBrandTertiary} />
            <Text style={styles.setupText}>Connectez votre capteur (Dexcom, Libre, Nightscout) pour la synchro automatique</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onBrandTertiary} />
          </Pressable>
        )}

        <GlucoseHeroCard
          busy={busy}
          error={error}
          errorDetail={errorDetail}
          latest={latest}
          targets={targets}
          units={units}
          trend={trend}
          diff={diff}
          colors={colors}
          styles={styles}
          onRetry={refetchAll}
        />

        <View style={styles.actionsRow}>
          <PrimaryButton
            label="Glycémie"
            variant="secondary"
            icon={<Ionicons name="water" size={18} color={colors.onBrandTertiary} />}
            onPress={() => router.push("/ajouter-glycemie")}
            testID="quick-add-glucose-button"
          />
          <PrimaryButton
            label="Calculer un bolus"
            icon={<Ionicons name="calculator" size={18} color={colors.onBrandPrimary} />}
            onPress={() => router.push("/calculateur")}
            testID="quick-bolus-button"
          />
        </View>

        {isHypoAlert ? (
          <HypoAlertBanner
            latestAt={latest.measured_at}
            colors={colors}
            styles={styles}
            onPress={() => router.push("/ajouter-glycemie")}
          />
        ) : null}

        <Pressable style={styles.coachCard} onPress={() => router.push("/coach")} testID="coach-card" accessibilityRole="button">
          <View style={styles.coachIcon}>
            <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.coachTitle}>Coach IA — insuline, repas, sport</Text>
            <Text style={styles.coachText}>Claude, GPT ou Gemini analysent vos données et proposent des pistes à discuter avec votre médecin</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.brandPrimary} />
        </Pressable>

        <Card testID="today-summary-card">
          <Text style={styles.sectionTitle}>Aujourd&apos;hui</Text>
          <View style={styles.tilesRow}>
            <StatTile label="Glucides" value={`${carbsToday}`} unit="g" color={colors.brandPrimary} />
            <StatTile label="Bolus" value={`${bolusToday}`} unit="U" color={colors.brandPrimary} />
            <StatTile label="TIR du jour" value={tirValue} unit={tirUnit} color={tirColor} />
          </View>
          <Pressable style={styles.basalRow} onPress={() => router.push("/ajouter-insuline")} testID="basal-today-row" accessibilityRole="button">
            <View style={[styles.activityIcon, { backgroundColor: basalToday.length > 0 ? `${colors.success}1A` : colors.surfaceTertiary }]}>
              <Ionicons name={basalToday.length > 0 ? "checkmark-circle" : "medkit-outline"} size={18} color={basalToday.length > 0 ? colors.success : colors.muted} />
            </View>
            <View style={styles.activityMain}>
              <Text style={styles.basalTitle}>Insuline lente (basale)</Text>
              <Text style={styles.activityMeta}>{basalMetaText}</Text>
            </View>
            <Ionicons name="add-circle-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
        </Card>

        <Card testID="recent-activity-card">
          <Text style={styles.sectionTitle}>Activité récente</Text>
          {activity.length === 0 ? (
            <Text style={styles.emptyText}>Vos mesures et repas apparaîtront ici.</Text>
          ) : (
            activity.map((item) => (
              <ActivityItem
                key={`${item.kind}-${item.id}`}
                item={item}
                targets={targets}
                colors={colors}
                units={units}
                styles={styles}
              />
            ))
          )}
        </Card>
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: bottomChrome + 16 }]} onPress={() => setMenuOpen(true)} testID="fab-add" accessibilityRole="button">
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <AddMenuModal
        open={menuOpen}
        insetsBottom={insets.bottom}
        colors={colors}
        styles={styles}
        onClose={() => setMenuOpen(false)}
        onNavigate={(path) => router.push(path as never)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flexOne: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
  },
  date: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
    textTransform: "capitalize",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  hypoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: `${colors.error}14`,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  hypoBannerTitle: { color: colors.error, fontSize: 13, fontWeight: "500" },
  hypoBannerText: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  coachCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.brandTertiary,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  coachIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  coachTitle: { color: colors.onBrandTertiary, fontSize: 14, fontWeight: "500" },
  coachText: { color: colors.onBrandTertiary, fontSize: 12, marginTop: 2, opacity: 0.85 },
  assistantBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  avatarText: {
    color: colors.onBrandTertiary,
    fontSize: 17,
    fontWeight: "500",
  },
  setupBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandTertiary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  setupText: {
    flex: 1,
    color: colors.onBrandTertiary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  cgmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 12,
  },
  cgmIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cgmInfo: {
    flex: 1,
  },
  cgmTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  cgmSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  cgmSyncButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  heroValue: {
    fontSize: 56,
    fontWeight: "500",
    lineHeight: 60,
  },
  heroSide: {
    alignItems: "flex-start",
    gap: 4,
    paddingBottom: 10,
  },
  heroZone: {
    fontSize: 12,
    fontWeight: "500",
  },
  heroMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 6,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: 12,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 12,
  },
  tilesRow: {
    flexDirection: "row",
    gap: 8,
  },
  basalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    minHeight: 48,
  },
  basalTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  activityPhoto: {
    width: 34,
    height: 34,
    borderRadius: 12,
  },
  activityMain: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: "500",
  },
  activityTitleDark: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  activityMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  activityTime: {
    color: colors.muted,
    fontSize: 12,
  },
  fab: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.onSurface,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  menuTitle: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    minHeight: 48,
  },
  menuItemText: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "500",
  },
  menuCancel: {
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
    paddingVertical: 8,
  },
}));