import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme } from "@/src/theme";
import { useAddInsulin, useInsulin } from "@/src/api";
import { INSULIN_KIND_LABELS, formatDayLabel, formatTime, parseNum, round1 } from "@/src/glucose";
import { Card, Chip, ChipRow, PrimaryButton, TextField } from "@/src/components/ui";
import { useToast } from "@/src/components/Toast";
import type { InsulinKind } from "@/src/types";

const KINDS: { key: InsulinKind; label: string; hint: string }[] = [
  { key: "basale", label: "Basale (lente)", hint: "Insuline lente quotidienne (Lantus, Toujeo, Tresiba, Levemir…)." },
  { key: "bolus", label: "Bolus (rapide)", hint: "Insuline rapide hors calculateur de repas." },
  { key: "correction", label: "Correction", hint: "Dose de correction d'une hyperglycémie." },
];

const BASAL_NAMES = ["Lantus", "Toujeo", "Tresiba", "Levemir", "Abasaglar"];

export default function AjouterInsuline() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const add = useAddInsulin();
  const history = useInsulin(20);

  const [kind, setKind] = useState<InsulinKind>("basale");
  const [units, setUnits] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const parsed = parseNum(units);
  const valid = parsed != null && parsed > 0 && parsed <= 200;
  const lastBasal = history.data?.find((d) => d.kind === "basale");
  const current = KINDS.find((k) => k.key === kind)!;

  const save = () => {
    if (!valid || parsed == null) return;
    add.mutate(
      { units: parsed, kind, insulin_name: name.trim(), note: note.trim() },
      {
        onSuccess: () => {
          toast.show(kind === "basale" ? "Insuline basale enregistrée" : "Injection enregistrée", "success");
          router.back();
        },
        onError: (e) => toast.show(e.message, "error"),
      },
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Injection d&apos;insuline</Text>
        <Text style={styles.subtitle}>Suivez votre insuline lente et vos bolus hors repas</Text>

        <Card style={{ marginTop: 16 }} testID="insulin-kind-card">
          <Text style={styles.label}>Type d&apos;insuline</Text>
          <ChipRow>
            {KINDS.map((k) => (
              <Chip key={k.key} label={k.label} selected={kind === k.key} onPress={() => setKind(k.key)} testID={`insulin-kind-${k.key}`} />
            ))}
          </ChipRow>
          <Text style={styles.hint}>{current.hint}</Text>
        </Card>

        <Card testID="insulin-form-card">
          <TextField label="Dose" value={units} onChangeText={setUnits} placeholder={kind === "basale" && lastBasal ? String(round1(lastBasal.units)) : "Ex : 18"} keyboardType="decimal" suffix="U" big testID="insulin-units-input" />
          {kind === "basale" && lastBasal ? (
            <View style={styles.lastRow} testID="insulin-last-basal">
              <Ionicons name="time-outline" size={14} color={colors.muted} />
              <Text style={styles.lastText}>
                Dernière basale : {round1(lastBasal.units)} U {lastBasal.insulin_name ? `(${lastBasal.insulin_name}) ` : ""}
                · {formatDayLabel(lastBasal.injected_at).toLowerCase()} à {formatTime(lastBasal.injected_at)}
              </Text>
            </View>
          ) : null}
          <TextField label="Nom de l'insuline (optionnel)" value={name} onChangeText={setName} placeholder={kind === "basale" ? "Ex : Lantus" : "Ex : Novorapid"} testID="insulin-name-input" />
          {kind === "basale" ? (
            <ChipRow>
              {BASAL_NAMES.map((n) => (
                <Chip key={n} label={n} selected={name === n} onPress={() => setName(name === n ? "" : n)} testID={`insulin-name-${n}`} />
              ))}
            </ChipRow>
          ) : null}
          <View style={{ height: 8 }} />
          <TextField label="Note (optionnel)" value={note} onChangeText={setNote} placeholder="Ex : injection cuisse gauche" testID="insulin-note-input" multiline />
        </Card>

        <PrimaryButton
          label={valid ? `Enregistrer ${round1(parsed!)} U (${INSULIN_KIND_LABELS[kind].toLowerCase()})` : "Enregistrer"}
          onPress={save}
          loading={add.isPending}
          disabled={!valid}
          testID="insulin-save-button"
        />
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
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
  },
  lastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  lastText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
}));
