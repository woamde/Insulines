import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useActivities, useAddActivity, useDeleteActivity } from "@/src/api";
import { useUnits } from "@/src/units";
import { ACTIVITY_LABELS, INTENSITY_LABELS, formatDayLabel, formatTime, parseNum } from "@/src/glucose";
import { Card, Chip, ChipRow, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import type { ActivityEntry, ActivityIntensity, ActivityType } from "@/src/types";

const TYPES: { key: ActivityType; icon: string }[] = [
  { key: "marche", icon: "walk" },
  { key: "course", icon: "speedometer" },
  { key: "velo", icon: "bicycle" },
  { key: "natation", icon: "water" },
  { key: "musculation", icon: "barbell" },
  { key: "autre", icon: "fitness" },
];
const INTENSITIES: ActivityIntensity[] = ["legere", "moderee", "intense"];
const DURATIONS = [15, 30, 45, 60, 90];
const START_OFFSETS = [
  { label: "À l'instant", minutes: 0 },
  { label: "Il y a 1 h", minutes: 60 },
  { label: "Il y a 2 h", minutes: 120 },
  { label: "Il y a 3 h", minutes: 180 },
];

export default function AjouterActivite() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const units = useUnits();
  const add = useAddActivity();
  const del = useDeleteActivity();
  const history = useActivities(20);

  const [type, setType] = useState<ActivityType>("marche");
  const [intensity, setIntensity] = useState<ActivityIntensity>("moderee");
  const [duration, setDuration] = useState("30");
  const [endOffset, setEndOffset] = useState(0);
  const [note, setNote] = useState("");

  const durationMin = parseNum(duration);
  const valid = durationMin != null && durationMin >= 5 && durationMin <= 600;

  const save = () => {
    if (!valid || durationMin == null) return;
    const started = new Date(Date.now() - (endOffset + durationMin) * 60_000).toISOString();
    add.mutate(
      { activity_type: type, duration_min: Math.round(durationMin), intensity, note: note.trim(), started_at: started },
      {
        onSuccess: () => {
          toast.show("Activité enregistrée", "success");
          router.back();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Activité physique</Text>
        <Text style={styles.subtitle}>Le sport apparaît sur votre courbe pour visualiser son effet sur la glycémie</Text>

        <Card style={{ marginTop: 16 }} testID="activity-type-card">
          <Text style={styles.label}>Type d&apos;activité</Text>
          <View style={styles.typeGrid}>
            {TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                style={[styles.typeTile, type === t.key && styles.typeTileActive]}
                testID={`activity-type-${t.key}`}
                accessibilityRole="button"
              >
                <Ionicons name={t.icon as never} size={22} color={type === t.key ? colors.onBrandPrimary : colors.brandPrimary} />
                <Text style={[styles.typeLabel, type === t.key && { color: colors.onBrandPrimary }]}>{ACTIVITY_LABELS[t.key]}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card testID="activity-form-card">
          <Text style={styles.label}>Durée</Text>
          <ChipRow>
            {DURATIONS.map((d) => (
              <Chip key={d} label={`${d} min`} selected={duration === String(d)} onPress={() => setDuration(String(d))} testID={`activity-duration-${d}`} />
            ))}
          </ChipRow>
          <TextField value={duration} onChangeText={setDuration} placeholder="30" keyboardType="numeric" suffix="min" testID="activity-duration-input" />

          <Text style={styles.label}>Intensité</Text>
          <ChipRow>
            {INTENSITIES.map((i) => (
              <Chip key={i} label={INTENSITY_LABELS[i]} selected={intensity === i} onPress={() => setIntensity(i)} testID={`activity-intensity-${i}`} />
            ))}
          </ChipRow>

          <Text style={[styles.label, { marginTop: 12 }]}>Terminée…</Text>
          <ChipRow>
            {START_OFFSETS.map((o) => (
              <Chip key={o.minutes} label={o.label} selected={endOffset === o.minutes} onPress={() => setEndOffset(o.minutes)} testID={`activity-end-${o.minutes}`} />
            ))}
          </ChipRow>
          <View style={{ height: 12 }} />
          <TextField label="Note (optionnel)" value={note} onChangeText={setNote} placeholder="Ex : collation de 15 g avant" testID="activity-note-input" />
        </Card>

        <PrimaryButton label="Enregistrer l'activité" onPress={save} loading={add.isPending} disabled={!valid} testID="activity-save-button" />

        <View style={styles.tipBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.onBrandTertiary} />
          <Text style={styles.tipText}>
            L&apos;effort peut faire baisser la glycémie pendant et jusqu&apos;à 24 h après. Pensez à contrôler avant, après et au coucher.
          </Text>
        </View>

        {history.data && history.data.length > 0 ? (
          <Card style={{ marginTop: 16 }} testID="activity-history-card">
            <Text style={styles.cardTitle}>Dernières séances et effet sur la glycémie</Text>
            {history.data.map((a, idx) => (
              <ActivityRow key={a.id} entry={a} first={idx === 0} unitsFmt={units.fmt} unitsDelta={units.fmtDelta} onDelete={() => del.mutate(a.id, { onSuccess: () => toast.show("Activité supprimée", "success"), onError: (e) => toast.show(e.message, "error") })} />
            ))}
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function ActivityRow({ entry, first, unitsFmt, unitsDelta, onDelete }: { entry: ActivityEntry; first: boolean; unitsFmt: (v: number) => string; unitsDelta: (v: number) => string; onDelete: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const eff = entry.effect;
  const effectText =
    eff.before_avg != null && eff.after_avg != null && eff.delta != null
      ? `${unitsFmt(eff.before_avg)} → ${unitsFmt(eff.after_avg)} (${unitsDelta(eff.delta)})`
      : eff.before_avg != null
        ? `Avant : ${unitsFmt(eff.before_avg)} · après : en attente de mesures`
        : "Pas de mesures autour de la séance";
  const effectColor = eff.hypo_after ? colors.error : eff.delta != null && eff.delta < 0 ? colors.info : colors.muted;
  return (
    <View style={[styles.row, !first && styles.rowBorder]} testID={`activity-row-${entry.id}`}>
      <View style={styles.rowIcon}>
        <Ionicons name={(TYPES.find((t) => t.key === entry.activity_type)?.icon ?? "fitness") as never} size={18} color={colors.info} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {ACTIVITY_LABELS[entry.activity_type]} · {entry.duration_min} min · {INTENSITY_LABELS[entry.intensity]}
        </Text>
        <Text style={styles.rowMeta}>
          {formatDayLabel(entry.started_at)} à {formatTime(entry.started_at)}
        </Text>
        <Text style={[styles.rowEffect, { color: effectColor }]} testID={`activity-effect-${entry.id}`}>
          {eff.hypo_after ? "⚠ Hypo après l'effort · " : ""}{effectText}
        </Text>
      </View>
      <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8} testID={`activity-delete-${entry.id}`} accessibilityRole="button">
        <Ionicons name="trash-outline" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 8,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeTile: {
    width: "31%",
    flexGrow: 1,
    minHeight: 64,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
  },
  typeTileActive: {
    backgroundColor: colors.brandPrimary,
  },
  typeLabel: {
    color: colors.brandPrimary,
    fontSize: 12,
    fontWeight: "500",
  },
  tipBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  tipText: {
    flex: 1,
    color: colors.onBrandTertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.info}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  rowEffect: {
    fontSize: 12,
    marginTop: 3,
    fontWeight: "500",
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
}));
