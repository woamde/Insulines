import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useAddWeight, useDeleteWeight, useProfile, useWeights } from "@/src/api";
import { formatDayLabel, parseNum, round1 } from "@/src/glucose";
import { Card, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";

export default function AjouterPoids() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const add = useAddWeight();
  const del = useDeleteWeight();
  const weights = useWeights(30);
  const profile = useProfile();

  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const parsed = parseNum(value);
  const valid = parsed != null && parsed >= 20 && parsed <= 400;
  const history = weights.data ?? [];
  const last = history[0];
  const reference = last?.weight_kg ?? profile.data?.weight_kg ?? null;
  const delta = valid && reference != null ? round1(parsed! - reference) : null;
  const heightM = profile.data?.height_cm ? profile.data.height_cm / 100 : null;
  const bmi = valid && heightM ? round1(parsed! / (heightM * heightM)) : null;

  const save = () => {
    if (!valid || parsed == null) return;
    add.mutate(
      { weight_kg: parsed, note: note.trim() },
      {
        onSuccess: () => {
          toast.show("Poids enregistré", "success");
          router.back();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mon poids</Text>
        <Text style={styles.subtitle}>Suivez votre prise ou perte de poids au fil du temps</Text>

        <Card style={{ marginTop: 16 }} testID="weight-form-card">
          <TextField label="Poids" value={value} onChangeText={setValue} placeholder={reference != null ? String(round1(reference)) : "Ex : 70,5"} keyboardType="decimal" suffix="kg" big testID="weight-value-input" />
          <View style={styles.previewRow}>
            {delta != null ? (
              <>
                <Ionicons
                  name={delta > 0 ? "trending-up" : delta < 0 ? "trending-down" : "remove"}
                  size={16}
                  color={delta === 0 ? colors.muted : delta > 0 ? colors.warning : colors.info}
                />
                <Text style={styles.previewLabel} testID="weight-delta-preview">
                  {delta === 0 ? "Poids stable" : `${delta > 0 ? "+" : ""}${delta} kg par rapport à la dernière pesée`}
                  {bmi ? ` · IMC ${bmi}` : ""}
                </Text>
              </>
            ) : (
              <Text style={styles.previewLabel}>{bmi ? `IMC ${bmi}` : "Pesez-vous de préférence le matin, à jeun."}</Text>
            )}
          </View>
          <TextField label="Note (optionnel)" value={note} onChangeText={setNote} placeholder="Ex : après les vacances" testID="weight-note-input" />
        </Card>

        <PrimaryButton label="Enregistrer" onPress={save} loading={add.isPending} disabled={!valid} testID="weight-save-button" />

        {history.length > 0 ? (
          <Card style={{ marginTop: 16 }} testID="weight-history-card">
            <Text style={styles.cardTitle}>Historique</Text>
            {history.map((w, idx) => {
              const prev = history[idx + 1];
              const d = prev ? round1(w.weight_kg - prev.weight_kg) : null;
              return (
                <View key={w.id} style={[styles.row, idx > 0 && styles.rowBorder]} testID={`weight-row-${w.id}`}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowValue}>{round1(w.weight_kg)} kg</Text>
                    <Text style={styles.rowMeta}>
                      {formatDayLabel(w.measured_at)}
                      {w.note ? ` · ${w.note}` : ""}
                    </Text>
                  </View>
                  {d != null && d !== 0 ? (
                    <Text style={[styles.rowDelta, { color: d > 0 ? colors.warning : colors.info }]}>{d > 0 ? "+" : ""}{d} kg</Text>
                  ) : null}
                  <Pressable
                    onPress={() => del.mutate(w.id, { onSuccess: () => toast.show("Pesée supprimée", "success"), onError: (e) => toast.show(e.message, "error") })}
                    style={styles.deleteButton}
                    hitSlop={8}
                    testID={`weight-delete-${w.id}`}
                    accessibilityRole="button"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.muted} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
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
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  previewLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowMain: {
    flex: 1,
  },
  rowValue: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "500",
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
    textTransform: "capitalize",
  },
  rowDelta: {
    fontSize: 13,
    fontWeight: "500",
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
}));
