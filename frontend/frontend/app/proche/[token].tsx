import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useSharedView } from "@/src/api";
import { SOURCE_LABELS, glucoseZone, relTime, zoneColor, zoneLabel } from "@/src/glucose";
import { unitsFor } from "@/src/units";
import { Card, EmptyState, LoadingState, StatTile } from "@/src/components/ui";
import { GlucoseChart } from "@/src/components/GlucoseChart";

/** Vue publique en lecture seule, ouverte par un proche depuis un lien de partage (aucune connexion requise). */
export default function VueProche() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const { token } = useLocalSearchParams<{ token: string }>();
  const view = useSharedView(typeof token === "string" ? token : "");

  if (view.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <LoadingState label="Chargement du suivi partagé…" />
      </View>
    );
  }
  if (view.isError || !view.data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]} testID="shared-error">
        <EmptyState
          icon={<Ionicons name="lock-closed-outline" size={36} color={colors.brandPrimary} />}
          title="Lien indisponible"
          message={view.error instanceof Error ? view.error.message : "Ce lien de partage n'est plus valide."}
        />
      </View>
    );
  }

  const data = view.data;
  const units = unitsFor(data.unit);
  const targets = { low: data.target_low, high: data.target_high };
  const latest = data.latest;
  const zone = latest ? glucoseZone(latest.value_mgdl, targets) : null;
  const s = data.summary_24h;
  const stale = latest ? Date.now() - new Date(latest.measured_at).getTime() > 3 * 3600_000 : false;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={view.isFetching} onRefresh={() => view.refetch()} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.headerRow}>
          <View style={styles.logo}>
            <Ionicons name="water" size={18} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} testID="shared-owner-name">Suivi de {data.owner_name}</Text>
            <Text style={styles.subtitle}>Partagé avec {data.label} · lecture seule · GlycoSoin T1D</Text>
          </View>
        </View>

        <Card style={styles.hero} testID="shared-latest-card">
          {latest && zone ? (
            <>
              <Text style={styles.heroLabel}>Dernière glycémie</Text>
              <View style={styles.heroRow}>
                <Text style={[styles.heroValue, { color: zoneColor(zone, colors) }]} testID="shared-latest-value">{units.fmt(latest.value_mgdl)}</Text>
                <View style={{ gap: 4 }}>
                  <Text style={styles.heroUnit}>{units.label}</Text>
                  {latest.delta != null ? <Text style={styles.heroDelta}>{units.fmtDelta(latest.delta)}</Text> : null}
                </View>
              </View>
              <View style={[styles.zoneBadge, { backgroundColor: `${zoneColor(zone, colors)}1A` }]}>
                <Text style={[styles.zoneText, { color: zoneColor(zone, colors) }]}>{zoneLabel(zone)}</Text>
              </View>
              <Text style={[styles.heroMeta, stale && { color: colors.warning }]}>
                {relTime(latest.measured_at)} · {SOURCE_LABELS[latest.source] ?? latest.source}
                {stale ? " · mesure ancienne" : ""}
              </Text>
            </>
          ) : (
            <Text style={styles.heroLabel}>Aucune glycémie enregistrée pour l&apos;instant</Text>
          )}
        </Card>

        <Card testID="shared-summary-card">
          <Text style={styles.cardTitle}>Dernières 24 heures</Text>
          <View style={styles.tilesRow}>
            <StatTile label="Moyenne" value={s.avg != null ? units.fmt(s.avg) : "—"} unit={s.avg != null ? units.label : undefined} color={colors.onSurface} />
            <StatTile label="Dans la cible" value={s.tir_in != null ? `${s.tir_in}` : "—"} unit={s.tir_in != null ? "%" : undefined} color={s.tir_in != null && s.tir_in >= 70 ? colors.success : colors.warning} />
            <StatTile label="Mesures" value={`${s.readings_count}`} color={colors.onSurface} />
          </View>
          <View style={styles.tilesRow}>
            <StatTile label={`Sous ${units.fmt(data.target_low)}`} value={`${s.hypo_count}`} color={s.hypo_count > 0 ? colors.error : colors.onSurface} />
            <StatTile label="Glucides" value={`${s.carbs_g}`} unit="g" color={colors.onSurface} />
            <StatTile label="Insuline" value={`${Math.round((s.bolus_units + s.basal_units) * 10) / 10}`} unit="U" color={colors.onSurface} />
          </View>
        </Card>

        <Card testID="shared-chart-card">
          <Text style={styles.cardTitle}>Courbe des 24 h</Text>
          {data.series.length > 0 ? (
            <GlucoseChart points={data.series.map((p) => ({ value: p.value_mgdl, at: p.measured_at }))} targets={targets} unit={data.unit} />
          ) : (
            <Text style={styles.emptyText}>Pas encore de mesures sur les dernières 24 h.</Text>
          )}
        </Card>

        <Text style={styles.footNote}>
          Ces informations sont partagées volontairement par {data.owner_name}. En cas d&apos;urgence (malaise, confusion, perte de connaissance), appelez le 15 ou le 112.
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 24,
  },
  heroLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  heroValue: {
    fontSize: 56,
    fontWeight: "500",
    lineHeight: 62,
  },
  heroUnit: {
    color: colors.muted,
    fontSize: 14,
  },
  heroDelta: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    fontWeight: "500",
  },
  zoneBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 8,
  },
  zoneText: {
    fontSize: 13,
    fontWeight: "500",
  },
  heroMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 8,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 12,
  },
  tilesRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  footNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 8,
  },
}));
